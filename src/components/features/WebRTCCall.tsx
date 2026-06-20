import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff,
  Volume2, VolumeX, X, RotateCcw, Monitor
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────
interface CallUser {
  id: string;
  username: string;
  avatar?: string | null;
}

interface ActiveCallState {
  id: string;
  remoteUser: CallUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
}

interface CallSettings {
  bg_color: string;
  bg_gradient_from: string;
  bg_gradient_to: string;
  accent_color: string;
  incoming_bg_from: string;
  incoming_bg_to: string;
}

// ── Context ────────────────────────────────────────────────────────────────
interface CallContextValue {
  startCall: (remoteUser: CallUser, callType: 'audio' | 'video') => Promise<void>;
  activeCall: ActiveCallState | null;
  setActiveCall: React.Dispatch<React.SetStateAction<ActiveCallState | null>>;
  callBg: string;
}

const CallContext = React.createContext<CallContextValue>({
  startCall: async () => {},
  activeCall: null,
  setActiveCall: () => {},
  callBg: 'linear-gradient(160deg, #0d0d1a 0%, #1a0026 100%)',
});

// ── useCall hook ───────────────────────────────────────────────────────────
export function useCall() {
  return React.useContext(CallContext);
}

// ── Avatar Component ───────────────────────────────────────────────────────
function UserAvatar({ user, size = 'lg' }: { user: CallUser; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const sizeMap = { sm: 'w-10 h-10 text-sm', md: 'w-16 h-16 text-lg', lg: 'w-24 h-24 text-2xl', xl: 'w-32 h-32 text-3xl' };
  return (
    <div className={`${sizeMap[size]} rounded-full overflow-hidden flex items-center justify-center flex-shrink-0`}
      style={{ background: 'linear-gradient(135deg, #FF1493, #FF69B4)' }}>
      {user.avatar
        ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
        : <span className="font-black text-white">{(user.username || '?')[0].toUpperCase()}</span>
      }
    </div>
  );
}

// ── Active Call Screen ─────────────────────────────────────────────────────
export function ActiveCallScreen({
  callId, localUser, remoteUser, callType, isInitiator, callBg, onEnd
}: {
  callId: string;
  localUser: CallUser;
  remoteUser: CallUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
  callBg: string;
  onEnd: () => void;
}) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(callType === 'video');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, []);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const autoHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setShowControls(true);
    if (callType === 'video') {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
    }
  }, [callType]);

  const endCall = useCallback(async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    remoteStreamRef.current?.getTracks().forEach(t => t.stop());
    if (pcRef.current) { try { pcRef.current.close(); } catch {} }
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId);
    onEnd();
  }, [callId, onEnd]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // Get local media
        const constraints = callType === 'video' ? { video: true, audio: true } : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current && callType === 'video') {
          localVideoRef.current.srcObject = stream;
        }

        // Create peer connection
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        stream.getTracks().forEach(t => pc.addTrack(t, stream));

        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;
        pc.ontrack = (event) => {
          event.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
          if (mounted) { setCallStatus('active'); startTimer(); }
        };

        pc.onicecandidate = async (event) => {
          if (!event.candidate) return;
          const { data: callData } = await supabase.from('calls').select('caller_id').eq('id', callId).single();
          if (!callData) return;
          const field = callData.caller_id === localUser.id ? 'caller_candidates' : 'callee_candidates';
          const { data: current } = await supabase.from('calls').select(field).eq('id', callId).single();
          const existing = (current as any)?.[field] || [];
          await supabase.from('calls').update({ [field]: [...existing, event.candidate.toJSON()] }).eq('id', callId);
        };

        if (isInitiator) {
          // Create and send offer
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await supabase.from('calls').update({
            offer: JSON.stringify({ type: offer.type, sdp: offer.sdp }),
            status: 'ringing',
          }).eq('id', callId);
          if (mounted) setCallStatus('ringing');
        }

        // Poll for signaling updates
        pollRef.current = setInterval(async () => {
          if (!mounted || doneRef.current) return;
          const { data: callData } = await supabase.from('calls').select('*').eq('id', callId).single();
          if (!callData) return;

          if (callData.status === 'ended') { endCall(); return; }

          // Initiator: watch for answer
          if (isInitiator && callData.answer && pc.signalingState === 'have-local-offer') {
            try {
              const answer = JSON.parse(callData.answer);
              await pc.setRemoteDescription(new RTCSessionDescription(answer));
              // Add callee ICE candidates
              const candidates = callData.callee_candidates || [];
              for (const c of candidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
              }
              if (mounted) setCallStatus('active');
            } catch {}
          }

          // Callee: watch for offer and create answer
          if (!isInitiator && callData.offer && pc.signalingState === 'stable' && !pc.remoteDescription) {
            try {
              const offer = JSON.parse(callData.offer);
              await pc.setRemoteDescription(new RTCSessionDescription(offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await supabase.from('calls').update({
                answer: JSON.stringify({ type: answer.type, sdp: answer.sdp }),
                status: 'active',
              }).eq('id', callId);
              // Add caller ICE candidates
              const candidates = callData.caller_candidates || [];
              for (const c of candidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
              }
              if (mounted) { setCallStatus('active'); startTimer(); }
            } catch {}
          }

          // Add new ICE candidates
          if (!isInitiator && callData.caller_candidates?.length) {
            const candidates = callData.caller_candidates;
            if (pc.remoteDescription && candidates.length > 0) {
              for (const c of candidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
              }
            }
          }
        }, 1500);

      } catch (err) {
        console.error('Call init error:', err);
        if (mounted) toast.error('Could not access camera/microphone');
        endCall();
      }
    }

    init();
    autoHideControls();

    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!doneRef.current) endCall();
    };
  }, [endCall]);

  function toggleMic() {
    const audio = localStreamRef.current?.getAudioTracks()[0];
    if (audio) { audio.enabled = !audio.enabled; setMicOn(audio.enabled); }
  }

  function toggleCam() {
    const video = localStreamRef.current?.getVideoTracks()[0];
    if (video) { video.enabled = !video.enabled; setCamOn(video.enabled); }
  }

  const isVideo = callType === 'video';

  return (
    <div
      className="fixed inset-0 z-[700] flex flex-col select-none"
      style={{ background: callBg }}
      onClick={autoHideControls}
    >
      {/* Remote video (full screen for video calls) */}
      {isVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: callStatus === 'active' ? 1 : 0, transition: 'opacity 0.5s' }}
        />
      )}

      {/* Blur overlay when not video or connecting */}
      {(!isVideo || callStatus !== 'active') && (
        <div className="absolute inset-0" style={{ background: callBg }} />
      )}

      {/* Main content */}
      <div className="relative z-10 flex flex-col h-full">
        {/* Top: caller info */}
        <div
          className="flex flex-col items-center justify-center flex-1 gap-4 pb-8"
          style={{ paddingTop: 'max(60px, env(safe-area-inset-top))' }}
        >
          {/* Avatar with pulse rings when ringing */}
          <div className="relative">
            {callStatus === 'ringing' && (
              <>
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="absolute inset-0 rounded-full border-2 border-primary/40"
                    style={{
                      animation: `callPulse 2s ease-out ${i * 0.5}s infinite`,
                      transform: `scale(${1 + i * 0.3})`,
                    }}
                  />
                ))}
              </>
            )}
            <UserAvatar user={remoteUser} size="xl" />
            {/* Online indicator */}
            <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-green-400 border-3 border-white/20" />
          </div>

          <div className="text-center">
            <p className="text-2xl font-black text-white mb-1">{remoteUser.username}</p>
            <p className="text-white/60 text-sm font-medium">
              {callStatus === 'connecting' ? 'Connecting...' :
               callStatus === 'ringing' ? (isInitiator ? 'Ringing...' : 'Incoming call...') :
               callStatus === 'active' ? formatDuration(duration) :
               'Call ended'}
            </p>
            {isVideo && (
              <p className="text-white/40 text-xs mt-1">
                {callType === 'video' ? '📹 Video call' : '🔊 Voice call'}
              </p>
            )}
          </div>
        </div>

        {/* Local video PiP */}
        {isVideo && (
          <div
            className="absolute top-20 right-4 w-28 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl"
            style={{ height: '36vw', maxHeight: 160, zIndex: 20 }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
              style={{ display: camOn ? 'block' : 'none' }}
            />
            {!camOn && (
              <div className="w-full h-full bg-gray-900 flex items-center justify-center">
                <UserAvatar user={localUser} size="sm" />
              </div>
            )}
          </div>
        )}

        {/* Controls */}
        <div
          className="flex-shrink-0 transition-opacity duration-300"
          style={{
            opacity: showControls ? 1 : 0,
            paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
            paddingLeft: 24, paddingRight: 24, paddingTop: 16,
            background: 'linear-gradient(0deg, rgba(0,0,0,0.6) 0%, transparent 100%)',
          }}
        >
          <div className="flex items-center justify-center gap-5">
            {/* Mute */}
            <button
              onClick={toggleMic}
              className="flex flex-col items-center gap-2 press"
            >
              <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${micOn ? 'bg-white/20 border border-white/30' : 'bg-red-500'}`}
                style={{ backdropFilter: 'blur(10px)' }}>
                {micOn ? <Mic className="w-6 h-6 text-white" /> : <MicOff className="w-6 h-6 text-white" />}
              </div>
              <span className="text-white/60 text-[10px]">{micOn ? 'Mute' : 'Unmute'}</span>
            </button>

            {/* Speaker */}
            <button
              onClick={() => setSpeakerOn(s => !s)}
              className="flex flex-col items-center gap-2 press"
            >
              <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${speakerOn ? 'bg-white/20 border border-white/30' : 'bg-orange-500'}`}
                style={{ backdropFilter: 'blur(10px)' }}>
                {speakerOn ? <Volume2 className="w-6 h-6 text-white" /> : <VolumeX className="w-6 h-6 text-white" />}
              </div>
              <span className="text-white/60 text-[10px]">{speakerOn ? 'Speaker' : 'Earpiece'}</span>
            </button>

            {/* End call */}
            <button onClick={endCall} className="flex flex-col items-center gap-2 press">
              <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-2xl"
                style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.6)' }}>
                <PhoneOff className="w-7 h-7 text-white" />
              </div>
              <span className="text-white/60 text-[10px]">End</span>
            </button>

            {/* Camera toggle (video only) */}
            {isVideo && (
              <button onClick={toggleCam} className="flex flex-col items-center gap-2 press">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${camOn ? 'bg-white/20 border border-white/30' : 'bg-red-500'}`}
                  style={{ backdropFilter: 'blur(10px)' }}>
                  {camOn ? <Video className="w-6 h-6 text-white" /> : <VideoOff className="w-6 h-6 text-white" />}
                </div>
                <span className="text-white/60 text-[10px]">{camOn ? 'Camera' : 'Camera off'}</span>
              </button>
            )}

            {/* Flip camera (video only, placeholder) */}
            {isVideo && (
              <button onClick={() => toast.info('Camera flip coming soon')} className="flex flex-col items-center gap-2 press">
                <div className="w-14 h-14 rounded-full bg-white/20 border border-white/30 flex items-center justify-center"
                  style={{ backdropFilter: 'blur(10px)' }}>
                  <RotateCcw className="w-6 h-6 text-white" />
                </div>
                <span className="text-white/60 text-[10px]">Flip</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes callPulse {
          0% { opacity: 0.8; transform: scale(1); }
          100% { opacity: 0; transform: scale(2.2); }
        }
      `}</style>
    </div>
  );
}

// ── Incoming Call Screen ───────────────────────────────────────────────────
function IncomingCallScreen({
  callId, caller, callType, callBg,
  onAccept, onDecline,
}: {
  callId: string;
  caller: CallUser;
  callType: 'audio' | 'video';
  callBg: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[700] flex flex-col items-center justify-between"
      style={{ background: callBg }}
    >
      {/* Animated rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="absolute w-48 h-48 rounded-full border border-primary/25"
            style={{ animation: `callPulse 2.5s ease-out ${i * 0.6}s infinite` }}
          />
        ))}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-5 relative z-10"
        style={{ paddingTop: 'max(60px, env(safe-area-inset-top))' }}>
        <UserAvatar user={caller} size="xl" />
        <div className="text-center">
          <p className="text-2xl font-black text-white mb-1">{caller.username}</p>
          <p className="text-white/50 text-sm">
            {callType === 'video' ? '📹 Incoming video call...' : '📞 Incoming audio call...'}
          </p>
        </div>
      </div>

      {/* Accept / Decline */}
      <div className="flex items-center justify-center gap-20 pb-16 relative z-10"
        style={{ paddingBottom: 'max(64px, env(safe-area-inset-bottom))' }}>
        {/* Decline */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onDecline}
            className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center press shadow-2xl"
            style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.5)' }}
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
          <span className="text-white/50 text-xs">Decline</span>
        </div>

        {/* Accept */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onAccept}
            className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center press shadow-2xl"
            style={{ boxShadow: '0 4px 24px rgba(34,197,94,0.5)' }}
          >
            {callType === 'video' ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
          </button>
          <span className="text-white/50 text-xs">Accept</span>
        </div>
      </div>

      <style>{`
        @keyframes callPulse {
          0% { opacity: 0.7; transform: scale(0.95); }
          100% { opacity: 0; transform: scale(2.5); }
        }
      `}</style>
    </div>
  );
}

// ── GlobalCallListener ─────────────────────────────────────────────────────
export function GlobalCallListener() {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<{
    id: string; caller: CallUser; callType: 'audio' | 'video';
  } | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [callSettings, setCallSettings] = useState<CallSettings>({
    bg_color: '#0d0d1a',
    bg_gradient_from: '#0d0d1a',
    bg_gradient_to: '#1a0026',
    accent_color: '#FF1493',
    incoming_bg_from: '#0d0d1a',
    incoming_bg_to: '#1a0026',
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkedCallIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    supabase.from('call_settings').select('*').eq('id', 'main').single().then(({ data }) => {
      if (data) setCallSettings(data as CallSettings);
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    pollRef.current = setInterval(async () => {
      if (activeCall) return; // Already in a call
      const { data: calls } = await supabase
        .from('calls')
        .select('*, caller:user_profiles!calls_caller_id_fkey(id, username, avatar_url)')
        .eq('callee_id', user.id)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!calls || calls.length === 0) return;
      const call = calls[0];
      if (checkedCallIds.current.has(call.id)) return;
      checkedCallIds.current.add(call.id);

      const caller = call.caller as any;
      if (!caller) return;

      setIncomingCall({
        id: call.id,
        caller: { id: caller.id, username: caller.username || 'Member', avatar: caller.avatar_url },
        callType: call.call_type as 'audio' | 'video',
      });
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, activeCall]);

  const callBg = `linear-gradient(160deg, ${callSettings.bg_gradient_from} 0%, ${callSettings.bg_gradient_to} 100%)`;
  const incomingBg = `linear-gradient(160deg, ${callSettings.incoming_bg_from} 0%, ${callSettings.incoming_bg_to} 100%)`;

  async function startCall(remoteUser: CallUser, callType: 'audio' | 'video') {
    if (!user) return;
    const { data, error } = await supabase.from('calls').insert({
      caller_id: user.id,
      callee_id: remoteUser.id,
      call_type: callType,
      status: 'ringing',
    }).select().single();
    if (error || !data) { toast.error('Failed to start call'); return; }
    setActiveCall({ id: data.id, remoteUser, callType, isInitiator: true });
  }

  function acceptIncoming() {
    if (!incomingCall || !user) return;
    const call = incomingCall;
    setIncomingCall(null);
    setActiveCall({
      id: call.id,
      remoteUser: call.caller,
      callType: call.callType,
      isInitiator: false,
    });
  }

  async function declineIncoming() {
    if (!incomingCall) return;
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', incomingCall.id);
    setIncomingCall(null);
  }

  return (
    <CallContext.Provider value={{ startCall, activeCall, setActiveCall, callBg }}>
      {incomingCall && !activeCall && (
        <IncomingCallScreen
          callId={incomingCall.id}
          caller={incomingCall.caller}
          callType={incomingCall.callType}
          callBg={incomingBg}
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}
      {activeCall && user && (
        <ActiveCallScreen
          callId={activeCall.id}
          localUser={{ id: user.id, username: user.username, avatar: user.avatar }}
          remoteUser={activeCall.remoteUser}
          callType={activeCall.callType}
          isInitiator={activeCall.isInitiator}
          callBg={callBg}
          onEnd={() => setActiveCall(null)}
        />
      )}
    </CallContext.Provider>
  );
}

// ── Default export ─────────────────────────────────────────────────────────
export default function WebRTCCall() {
  return null;
}
