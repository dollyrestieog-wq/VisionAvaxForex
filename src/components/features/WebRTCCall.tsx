// ⚠️ DO NOT REPLACE THIS FILE — Core React component required by Messenger.tsx and App.tsx
// Required exports: useCall, ActiveCallScreen, GlobalCallListener
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff,
  Volume2, VolumeX, X, FlipHorizontal, Monitor
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ──
interface RemoteUser {
  id: string;
  username: string;
  avatar?: string;
}

interface ActiveCallState {
  id: string;
  remoteUser: RemoteUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
}

interface CallContextValue {
  startCall: (user: RemoteUser, type: 'audio' | 'video') => void;
  activeCall: ActiveCallState | null;
  setActiveCall: (call: ActiveCallState | null) => void;
  callBg: string;
}

// ── Global call context ──
const CallContext = React.createContext<CallContextValue>({
  startCall: () => {},
  activeCall: null,
  setActiveCall: () => {},
  callBg: '#0d0d1a',
});

export function useCall() {
  return React.useContext(CallContext);
}

// ── Format duration ──
function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// ── Avatar fallback ──
function Avatar({ user, size = 80 }: { user: RemoteUser; size?: number }) {
  return user.avatar ? (
    <img
      src={user.avatar}
      alt={user.username}
      className="rounded-full object-cover border-2 border-white/20"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="rounded-full flex items-center justify-center font-black text-white"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #FF1493, #FF69B4)',
        fontSize: size * 0.35,
      }}
    >
      {user.username[0]?.toUpperCase() || '?'}
    </div>
  );
}

// ── Active Call Screen ──
export function ActiveCallScreen({
  callId,
  localUser,
  remoteUser,
  callType,
  isInitiator,
  callBg,
  onEnd,
}: {
  callId: string;
  localUser: RemoteUser;
  remoteUser: RemoteUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
  callBg: string;
  onEnd: () => void;
}) {
  const [callState, setCallState] = useState<'connecting' | 'ringing' | 'connected' | 'ended'>(
    isInitiator ? 'ringing' : 'connecting'
  );
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(callType === 'video');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-hide controls after 4s
  function resetControlsTimer() {
    setControlsVisible(true);
    if (hideControlsRef.current) clearTimeout(hideControlsRef.current);
    hideControlsRef.current = setTimeout(() => {
      if (callState === 'connected') setControlsVisible(false);
    }, 4000);
  }

  // Duration timer
  useEffect(() => {
    if (callState === 'connected') {
      durationRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      resetControlsTimer();
    }
    return () => {
      if (durationRef.current) clearInterval(durationRef.current);
      if (hideControlsRef.current) clearTimeout(hideControlsRef.current);
    };
  }, [callState]);

  // Setup WebRTC
  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === 'video',
          audio: true,
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        });
        pcRef.current = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.ontrack = (evt) => {
          if (remoteVideoRef.current && evt.streams[0]) {
            remoteVideoRef.current.srcObject = evt.streams[0];
          }
        };

        const candidatesQueue: RTCIceCandidate[] = [];
        pc.onicecandidate = async (evt) => {
          if (!evt.candidate) return;
          candidatesQueue.push(evt.candidate);
          // Store candidates in DB
          const { data: row } = await supabase
            .from('calls')
            .select('caller_candidates, callee_candidates, caller_id')
            .eq('id', callId)
            .single();
          if (!row) return;
          const isCaller = row.caller_id === localUser.id;
          const field = isCaller ? 'caller_candidates' : 'callee_candidates';
          const existing = (row[field] as any[]) || [];
          await supabase
            .from('calls')
            .update({ [field]: [...existing, evt.candidate.toJSON()] })
            .eq('id', callId);
        };

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await supabase
            .from('calls')
            .update({ offer: JSON.stringify(offer), status: 'ringing' })
            .eq('id', callId);

          // Poll for answer
          pollRef.current = setInterval(async () => {
            const { data } = await supabase
              .from('calls')
              .select('answer, callee_candidates, status')
              .eq('id', callId)
              .single();
            if (!data || !mounted) return;
            if (data.status === 'rejected' || data.status === 'ended') {
              cleanup();
              onEnd();
              return;
            }
            if (data.answer && pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(JSON.parse(data.answer));
              if (mounted) setCallState('connected');
              // Add queued ICE candidates
              for (const c of (data.callee_candidates as any[] || [])) {
                await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              }
            }
          }, 2000);
        } else {
          // Callee: wait for offer
          const waitOffer = setInterval(async () => {
            const { data } = await supabase
              .from('calls')
              .select('offer, caller_candidates, status')
              .eq('id', callId)
              .single();
            if (!data || !mounted) return;
            if (data.status === 'ended') { cleanup(); onEnd(); return; }
            if (data.offer && pc.signalingState === 'stable') {
              clearInterval(waitOffer);
              await pc.setRemoteDescription(JSON.parse(data.offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await supabase
                .from('calls')
                .update({ answer: JSON.stringify(answer), status: 'active' })
                .eq('id', callId);
              if (mounted) setCallState('connected');
              for (const c of (data.caller_candidates as any[] || [])) {
                await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              }
              // Poll for ended status
              pollRef.current = setInterval(async () => {
                const { data: d } = await supabase
                  .from('calls')
                  .select('status')
                  .eq('id', callId)
                  .single();
                if (d?.status === 'ended' && mounted) { cleanup(); onEnd(); }
              }, 3000);
            }
          }, 2000);
        }
      } catch (err) {
        console.error('WebRTC setup error:', err);
        if (mounted) setCallState('ended');
      }
    }

    function cleanup() {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (pcRef.current) pcRef.current.close();
    }

    setup();
    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (pcRef.current) pcRef.current.close();
    };
  }, [callId, isInitiator, callType]);

  async function hangUp() {
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId);
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (pcRef.current) pcRef.current.close();
    if (pollRef.current) clearInterval(pollRef.current);
    onEnd();
  }

  function toggleMute() {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = isMuted; });
      setIsMuted(!isMuted);
    }
  }

  function toggleVideo() {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = !isVideoOn; });
      setIsVideoOn(!isVideoOn);
    }
  }

  const statusLabel =
    callState === 'ringing' ? 'Ringing...' :
    callState === 'connecting' ? 'Connecting...' :
    callState === 'connected' ? formatDuration(duration) : 'Call ended';

  return (
    <div
      className="fixed inset-0 z-[700] flex flex-col overflow-hidden select-none"
      style={{ background: callBg || 'linear-gradient(160deg, #0d0d1a 0%, #1a0026 100%)' }}
      onClick={resetControlsTimer}
    >
      {/* Remote video / avatar */}
      {callType === 'video' ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
          {/* Pulse rings */}
          <div className="relative flex items-center justify-center">
            {callState !== 'connected' && (
              <>
                <div className="absolute w-44 h-44 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: '2s' }} />
                <div className="absolute w-36 h-36 rounded-full bg-primary/15 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
              </>
            )}
            <Avatar user={remoteUser} size={112} />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-black text-white">{remoteUser.username}</h2>
            <p className="text-white/60 mt-1">{statusLabel}</p>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div
        className="relative z-10 flex items-center justify-between px-5 pt-12 pb-4 transition-opacity duration-300"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
          opacity: callType === 'video' ? (controlsVisible ? 1 : 0) : 1,
        }}
      >
        <div className="text-center flex-1">
          {callType === 'video' && (
            <>
              <h2 className="text-white font-black text-lg">{remoteUser.username}</h2>
              <p className="text-white/60 text-sm">{statusLabel}</p>
            </>
          )}
        </div>
        <button onClick={hangUp} className="absolute right-4 top-12 p-2 rounded-full bg-white/10 backdrop-blur-md">
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Local video PiP */}
      {callType === 'video' && (
        <div className="absolute top-20 right-4 z-20 w-28 h-40 rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-black/60">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>
      )}

      {/* Controls */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 transition-opacity duration-300"
        style={{
          opacity: callType === 'video' ? (controlsVisible ? 1 : 0) : 1,
          background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
          paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
          paddingTop: '48px',
        }}
      >
        {/* Secondary controls */}
        <div className="flex justify-center gap-5 mb-6">
          <button
            onClick={() => setIsSpeakerOn(!isSpeakerOn)}
            className="flex flex-col items-center gap-1.5"
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isSpeakerOn ? 'bg-white/20' : 'bg-white/10'}`}>
              {isSpeakerOn ? <Volume2 className="w-5 h-5 text-white" /> : <VolumeX className="w-5 h-5 text-white/50" />}
            </div>
            <span className="text-white/60 text-[10px]">Speaker</span>
          </button>

          <button onClick={toggleMute} className="flex flex-col items-center gap-1.5">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-red-500/30' : 'bg-white/20'}`}>
              {isMuted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5 text-white" />}
            </div>
            <span className="text-white/60 text-[10px]">{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          {callType === 'video' && (
            <button onClick={toggleVideo} className="flex flex-col items-center gap-1.5">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${!isVideoOn ? 'bg-red-500/30' : 'bg-white/20'}`}>
                {isVideoOn ? <Video className="w-5 h-5 text-white" /> : <VideoOff className="w-5 h-5 text-red-400" />}
              </div>
              <span className="text-white/60 text-[10px]">Camera</span>
            </button>
          )}
        </div>

        {/* End call */}
        <div className="flex justify-center">
          <button
            onClick={hangUp}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 active:scale-90 flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all"
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Global Call Listener — placed in App.tsx ──
export function GlobalCallListener() {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<{
    id: string;
    caller: RemoteUser;
    callType: 'audio' | 'video';
  } | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [callBg, setCallBg] = useState('linear-gradient(160deg, #0d0d1a 0%, #1a0026 100%)');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startCallRef = useRef<((user: RemoteUser, type: 'audio' | 'video') => void) | null>(null);

  // Load call background from site_settings
  useEffect(() => {
    supabase
      .from('site_settings')
      .select('bg_gradient_from,bg_gradient_to')
      .eq('id', 'main')
      .single()
      .then(({ data }) => {
        if (data) {
          const from = (data as any).bg_gradient_from || '#0d0d1a';
          const to = (data as any).bg_gradient_to || '#1a0026';
          setCallBg(`linear-gradient(160deg, ${from} 0%, ${to} 100%)`);
        }
      });
  }, []);

  // Poll for incoming calls
  useEffect(() => {
    if (!user) return;
    pollRef.current = setInterval(async () => {
      if (activeCall || incomingCall) return;
      const { data } = await supabase
        .from('calls')
        .select('id, caller_id, call_type, user_profiles!calls_caller_id_fkey(id,username,avatar_url)')
        .eq('callee_id', user.id)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        const callerProfile = (data as any).user_profiles;
        setIncomingCall({
          id: data.id,
          caller: {
            id: data.caller_id,
            username: callerProfile?.username || 'Unknown',
            avatar: callerProfile?.avatar_url,
          },
          callType: data.call_type as 'audio' | 'video',
        });
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, activeCall, incomingCall]);

  const startCall = useCallback(async (remoteUser: RemoteUser, type: 'audio' | 'video') => {
    if (!user) return;
    const { data } = await supabase
      .from('calls')
      .insert({
        caller_id: user.id,
        callee_id: remoteUser.id,
        call_type: type,
        status: 'ringing',
      })
      .select()
      .single();
    if (data) {
      setActiveCall({
        id: data.id,
        remoteUser,
        callType: type,
        isInitiator: true,
      });
    }
  }, [user]);

  async function acceptCall() {
    if (!incomingCall || !user) return;
    await supabase.from('calls').update({ status: 'active' }).eq('id', incomingCall.id);
    setActiveCall({
      id: incomingCall.id,
      remoteUser: incomingCall.caller,
      callType: incomingCall.callType,
      isInitiator: false,
    });
    setIncomingCall(null);
  }

  async function rejectCall() {
    if (!incomingCall) return;
    await supabase.from('calls').update({ status: 'rejected' }).eq('id', incomingCall.id);
    setIncomingCall(null);
  }

  return (
    <CallContext.Provider value={{ startCall, activeCall, setActiveCall, callBg }}>
      {/* Incoming call UI */}
      {incomingCall && !activeCall && (
        <div
          className="fixed inset-0 z-[800] flex flex-col items-center justify-center"
          style={{ background: callBg }}
        >
          {/* Pulse rings */}
          <div className="relative flex items-center justify-center mb-8">
            <div className="absolute w-52 h-52 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: '2.5s' }} />
            <div className="absolute w-44 h-44 rounded-full bg-primary/15 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.6s' }} />
            <div className="absolute w-36 h-36 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '1.2s' }} />
            <Avatar user={incomingCall.caller} size={120} />
          </div>

          <h2 className="text-3xl font-black text-white mb-2">{incomingCall.caller.username}</h2>
          <p className="text-white/60 mb-2">
            Incoming {incomingCall.callType === 'video' ? 'Video' : 'Audio'} Call
          </p>
          <div className="flex items-center gap-1 text-white/40 text-sm mb-16">
            {incomingCall.callType === 'video' ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            <span>VISION AVAX FOREX</span>
          </div>

          <div className="flex items-center gap-16">
            {/* Reject */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={rejectCall}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 active:scale-90 flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all"
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <span className="text-white/50 text-xs">Decline</span>
            </div>
            {/* Accept */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={acceptCall}
                className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-400 active:scale-90 flex items-center justify-center shadow-2xl shadow-green-500/40 transition-all"
              >
                <Phone className="w-7 h-7 text-white" />
              </button>
              <span className="text-white/50 text-xs">Accept</span>
            </div>
          </div>
        </div>
      )}

      {/* Active call */}
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
