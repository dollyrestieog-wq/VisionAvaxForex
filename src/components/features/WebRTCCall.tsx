import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, RotateCcw, Monitor } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ──
interface CallUser {
  id: string;
  username: string;
  avatar?: string;
}

interface ActiveCall {
  id: string;
  remoteUser: CallUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
}

interface CallState {
  activeCall: ActiveCall | null;
  setActiveCall: (call: ActiveCall | null) => void;
  startCall: (user: CallUser, type: 'audio' | 'video') => void;
  callBg: string;
}

// ── STUN servers ──
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ── Global call state (module-level singleton) ──
let _activeCall: ActiveCall | null = null;
let _setActiveCallFn: ((c: ActiveCall | null) => void) | null = null;
let _callBg = 'linear-gradient(135deg, #0d0d1a 0%, #1a0026 100%)';

// ── useCall hook ──
export function useCall(): CallState {
  const { user } = useAuth();
  const [activeCall, setActiveCallState] = useState<ActiveCall | null>(_activeCall);

  const setActiveCall = useCallback((call: ActiveCall | null) => {
    _activeCall = call;
    setActiveCallState(call);
    if (_setActiveCallFn) _setActiveCallFn(call);
  }, []);

  // Register setter so GlobalCallListener can sync state
  useEffect(() => {
    _setActiveCallFn = setActiveCallState;
    return () => { _setActiveCallFn = null; };
  }, []);

  const startCall = useCallback(async (remoteUser: CallUser, callType: 'audio' | 'video') => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from('calls').insert({
        caller_id: user.id,
        callee_id: remoteUser.id,
        call_type: callType,
        status: 'ringing',
      }).select().single();

      if (error || !data) {
        console.error('Failed to create call:', error);
        return;
      }

      const call: ActiveCall = {
        id: data.id,
        remoteUser,
        callType,
        isInitiator: true,
      };
      setActiveCall(call);
    } catch (err) {
      console.error('startCall error:', err);
    }
  }, [user, setActiveCall]);

  return { activeCall, setActiveCall, startCall, callBg: _callBg };
}

// ── ActiveCallScreen ──
interface ActiveCallScreenProps {
  callId: string;
  localUser: CallUser;
  remoteUser: CallUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
  callBg: string;
  onEnd: () => void;
}

export function ActiveCallScreen({ callId, localUser, remoteUser, callType, isInitiator, callBg, onEnd }: ActiveCallScreenProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callStatus, setCallStatus] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const resetHideTimer = () => {
    setShowControls(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
  };

  // Get local media
  useEffect(() => {
    async function getMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === 'video',
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        setupPeerConnection(stream);
      } catch (err) {
        console.error('Media access error:', err);
      }
    }
    getMedia();
    resetHideTimer();
    return () => {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      if (pcRef.current) pcRef.current.close();
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function setupPeerConnection(stream: MediaStream) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      const { data: callRow } = await supabase.from('calls').select('caller_id, callee_id, caller_candidates, callee_candidates').eq('id', callId).single();
      if (!callRow) return;
      const isCallerSide = callRow.caller_id === localUser.id;
      const field = isCallerSide ? 'caller_candidates' : 'callee_candidates';
      const existing = callRow[field as keyof typeof callRow] as any[] || [];
      await supabase.from('calls').update({ [field]: [...existing, event.candidate.toJSON()] }).eq('id', callId);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCallStatus('connected');
        durationTimerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        handleEnd();
      }
    };

    if (isInitiator) {
      createOffer(pc);
    } else {
      pollForOffer(pc);
    }
  }

  async function createOffer(pc: RTCPeerConnection) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await supabase.from('calls').update({ offer: JSON.stringify(offer), status: 'ringing' }).eq('id', callId);
    pollForAnswer(pc);
  }

  async function pollForAnswer(pc: RTCPeerConnection) {
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.from('calls').select('answer, callee_candidates, status').eq('id', callId).single();
      if (!data) return;
      if (data.status === 'ended') { handleEnd(); return; }
      if (data.answer && !pc.remoteDescription) {
        await pc.setRemoteDescription(JSON.parse(data.answer));
      }
      if (data.callee_candidates && pc.remoteDescription) {
        for (const cand of data.callee_candidates as any[]) {
          try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
        }
      }
    }, 2000);
  }

  async function pollForOffer(pc: RTCPeerConnection) {
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.from('calls').select('offer, caller_candidates, status').eq('id', callId).single();
      if (!data) return;
      if (data.status === 'ended') { handleEnd(); return; }
      if (data.offer && !pc.remoteDescription) {
        await pc.setRemoteDescription(JSON.parse(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await supabase.from('calls').update({ answer: JSON.stringify(answer), status: 'active' }).eq('id', callId);
      }
      if (data.caller_candidates && pc.remoteDescription) {
        for (const cand of data.caller_candidates as any[]) {
          try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
        }
      }
    }, 2000);
  }

  async function handleEnd() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId);
    setCallStatus('ended');
    setTimeout(onEnd, 500);
  }

  function toggleMute() {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; });
    setIsMuted(!isMuted);
  }

  function toggleVideo() {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; });
    setIsVideoOff(!isVideoOff);
  }

  async function toggleScreenShare() {
    if (isScreenSharing) {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender && stream.getVideoTracks()[0]) sender.replaceTrack(stream.getVideoTracks()[0]);
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
        if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;
        const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (sender && screenStream.getVideoTracks()[0]) sender.replaceTrack(screenStream.getVideoTracks()[0]);
        setIsScreenSharing(true);
      } catch {}
    }
  }

  // Pulse animation keyframes
  const pulseStyle = `
    @keyframes pulse-ring {
      0% { transform: scale(1); opacity: 0.7; }
      100% { transform: scale(2.2); opacity: 0; }
    }
  `;

  return (
    <div
      className="fixed inset-0 z-[700] flex flex-col"
      style={{ background: callBg }}
      onClick={resetHideTimer}
    >
      <style>{pulseStyle}</style>

      {/* Remote video / avatar */}
      {callType === 'video' ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Pulse rings for ringing state */}
          {callStatus === 'ringing' && (
            <>
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="absolute rounded-full border-2 border-white/20"
                  style={{
                    width: 120,
                    height: 120,
                    animation: `pulse-ring 2s ease-out ${i * 0.6}s infinite`,
                  }}
                />
              ))}
            </>
          )}
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-white/20 shadow-2xl">
              {remoteUser.avatar
                ? <img src={remoteUser.avatar} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center"><span className="text-4xl font-black text-white">{(remoteUser.username || '?')[0].toUpperCase()}</span></div>
              }
            </div>
            <p className="text-2xl font-black text-white tracking-tight">{remoteUser.username}</p>
            <p className="text-sm text-white/60">
              {callStatus === 'ringing' ? (isInitiator ? 'Calling...' : 'Incoming call...') : callStatus === 'connected' ? formatDuration(duration) : 'Call ended'}
            </p>
          </div>
        </div>
      )}

      {/* Video status overlay */}
      {callType === 'video' && callStatus !== 'connected' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white/20 shadow-2xl mb-4">
            {remoteUser.avatar
              ? <img src={remoteUser.avatar} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center"><span className="text-3xl font-black text-white">{(remoteUser.username || '?')[0].toUpperCase()}</span></div>
            }
          </div>
          <p className="text-xl font-black text-white">{remoteUser.username}</p>
          <p className="text-sm text-white/60 mt-1">{callStatus === 'ringing' ? 'Connecting...' : 'Call ended'}</p>
        </div>
      )}

      {/* Local video PiP */}
      {callType === 'video' && (
        <div className="absolute top-20 right-4 z-20 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
        </div>
      )}

      {/* Top bar */}
      <div
        className="relative z-30 flex items-center justify-between px-4 transition-opacity duration-300"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top))', opacity: showControls ? 1 : 0 }}
      >
        <div className="flex flex-col">
          <span className="text-white font-black text-lg">{remoteUser.username}</span>
          <span className="text-white/60 text-sm">
            {callStatus === 'connected' ? formatDuration(duration) : callStatus === 'ringing' ? (isInitiator ? 'Ringing...' : 'Incoming...') : 'Ended'}
          </span>
        </div>
        {callStatus === 'connected' && (
          <div className="flex items-center gap-1 px-2 py-1 bg-green-500/25 rounded-full border border-green-500/40">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-bold">Live</span>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div
        className="absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-300"
        style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))', opacity: showControls ? 1 : 0 }}
      >
        <div className="flex items-center justify-center gap-5 px-6">
          {/* Mute */}
          <button
            onClick={toggleMute}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: isMuted ? 'rgba(239,68,68,0.85)' : 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}
          >
            {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
          </button>

          {/* End call */}
          <button
            onClick={handleEnd}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 8px 32px rgba(239,68,68,0.5)' }}
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>

          {/* Video toggle or screen share */}
          {callType === 'video' ? (
            <button
              onClick={toggleVideo}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: isVideoOff ? 'rgba(239,68,68,0.85)' : 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}
            >
              {isVideoOff ? <VideoOff className="w-6 h-6 text-white" /> : <Video className="w-6 h-6 text-white" />}
            </button>
          ) : (
            <button
              onClick={toggleScreenShare}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: isScreenSharing ? 'rgba(59,130,246,0.85)' : 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}
            >
              {isScreenSharing ? <RotateCcw className="w-6 h-6 text-white" /> : <Monitor className="w-6 h-6 text-white" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── GlobalCallListener ── (mounted in App.tsx to handle incoming calls)
export function GlobalCallListener() {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<{ id: string; callerId: string; callerName: string; callerAvatar?: string; callType: 'audio' | 'video' } | null>(null);
  const [activeCall, setActiveCallState] = useState<ActiveCall | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  // Load call background setting
  useEffect(() => {
    supabase.from('site_settings').select('call_settings').eq('id', 'main').single().then(({ data }) => {
      const cs = (data as any)?.call_settings;
      if (cs?.bg_gradient_from && cs?.bg_gradient_to) {
        _callBg = `linear-gradient(135deg, ${cs.bg_gradient_from} 0%, ${cs.bg_gradient_to} 100%)`;
      }
    });
  }, []);

  // Sync active call from module state
  useEffect(() => {
    _setActiveCallFn = setActiveCallState;
    return () => { _setActiveCallFn = null; };
  }, []);

  useEffect(() => {
    if (!user) return;

    async function pollCalls() {
      const { data } = await supabase
        .from('calls')
        .select('*, caller:user_profiles!calls_caller_id_fkey(id, username, avatar_url)')
        .eq('callee_id', user!.id)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !incomingCall && !activeCall) {
        const caller = (data as any).caller;
        setIncomingCall({
          id: data.id,
          callerId: data.caller_id,
          callerName: caller?.username || 'Unknown',
          callerAvatar: caller?.avatar_url,
          callType: data.call_type as 'audio' | 'video',
        });
        // Play ringtone
        try {
          if (!ringtoneRef.current) {
            ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
            ringtoneRef.current.loop = true;
          }
          ringtoneRef.current.play().catch(() => {});
        } catch {}
      }
    }

    pollRef.current = setInterval(pollCalls, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, incomingCall, activeCall]);

  function stopRingtone() {
    try { ringtoneRef.current?.pause(); ringtoneRef.current = null; } catch {}
  }

  async function acceptCall() {
    if (!incomingCall || !user) return;
    stopRingtone();
    const call: ActiveCall = {
      id: incomingCall.id,
      remoteUser: { id: incomingCall.callerId, username: incomingCall.callerName, avatar: incomingCall.callerAvatar },
      callType: incomingCall.callType,
      isInitiator: false,
    };
    _activeCall = call;
    setActiveCallState(call);
    if (_setActiveCallFn) _setActiveCallFn(call);
    await supabase.from('calls').update({ status: 'active', started_at: new Date().toISOString() }).eq('id', incomingCall.id);
    setIncomingCall(null);
  }

  async function rejectCall() {
    if (!incomingCall) return;
    stopRingtone();
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', incomingCall.id);
    setIncomingCall(null);
  }

  const pulseStyle = `
    @keyframes pulse-ring {
      0% { transform: scale(1); opacity: 0.7; }
      100% { transform: scale(2.5); opacity: 0; }
    }
  `;

  return (
    <>
      {/* Incoming call overlay */}
      {incomingCall && !activeCall && (
        <div
          className="fixed inset-0 z-[800] flex flex-col items-center justify-center"
          style={{ background: _callBg }}
        >
          <style>{pulseStyle}</style>
          <div className="flex flex-col items-center gap-5 flex-1 justify-center">
            {/* Pulse rings */}
            <div className="relative flex items-center justify-center">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="absolute rounded-full border-2 border-white/20"
                  style={{ width: 128, height: 128, animation: `pulse-ring 2s ease-out ${i * 0.65}s infinite` }}
                />
              ))}
              <div className="relative z-10 w-32 h-32 rounded-full overflow-hidden border-4 border-white/25 shadow-2xl">
                {incomingCall.callerAvatar
                  ? <img src={incomingCall.callerAvatar} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-gradient-to-br from-pink-500 to-purple-700 flex items-center justify-center"><span className="text-5xl font-black text-white">{incomingCall.callerName[0]?.toUpperCase()}</span></div>
                }
              </div>
            </div>
            <div className="text-center">
              <p className="text-3xl font-black text-white mb-1">{incomingCall.callerName}</p>
              <p className="text-white/60 text-base">Incoming {incomingCall.callType === 'video' ? 'Video' : 'Audio'} Call</p>
            </div>
          </div>

          {/* Accept / Reject */}
          <div className="flex items-center justify-center gap-16 pb-16" style={{ paddingBottom: 'max(64px, env(safe-area-inset-bottom))' }}>
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={rejectCall}
                className="w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-95"
                style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)', boxShadow: '0 8px 32px rgba(239,68,68,0.5)' }}
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <span className="text-white/60 text-xs font-bold">Decline</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={acceptCall}
                className="w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-95"
                style={{ background: 'linear-gradient(135deg, #22c55e, #15803d)', boxShadow: '0 8px 32px rgba(34,197,94,0.5)' }}
              >
                <Phone className="w-7 h-7 text-white" />
              </button>
              <span className="text-white/60 text-xs font-bold">Accept</span>
            </div>
          </div>
        </div>
      )}

      {/* Active call screen (initiated from GlobalCallListener) */}
      {activeCall && user && (
        <ActiveCallScreen
          callId={activeCall.id}
          localUser={{ id: user.id, username: user.username, avatar: user.avatar }}
          remoteUser={activeCall.remoteUser}
          callType={activeCall.callType}
          isInitiator={activeCall.isInitiator}
          callBg={_callBg}
          onEnd={() => {
            _activeCall = null;
            setActiveCallState(null);
            if (_setActiveCallFn) _setActiveCallFn(null);
          }}
        />
      )}
    </>
  );
}
