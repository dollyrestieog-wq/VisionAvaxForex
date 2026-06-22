
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, VolumeX,
  RotateCcw, PhoneMissed, UserPlus, MoreHorizontal, MonitorUp, Send, X, Sparkles,
  CameraOff, Wifi, WifiOff
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { UserProfile } from '@/types';
import { toast } from 'sonner';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
  ],
  iceCandidatePoolSize: 10,
};

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function createRingtone(customUrl?: string): () => void {
  let running = true;
  if (customUrl) {
    const audio = new Audio(customUrl);
    audio.loop = true;
    audio.play().catch(() => {});
    return () => { running = false; audio.pause(); audio.currentTime = 0; };
  }
  let iv: ReturnType<typeof setInterval> | null = null;
  function ring() {
    if (!running) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const g = ctx.createGain(); g.gain.value = 0.25; g.connect(ctx.destination);
      [480, 620].forEach(f => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        o.connect(g); o.start(); o.stop(ctx.currentTime + 1.1);
      });
      setTimeout(() => { try { ctx.close(); } catch {} }, 1300);
    } catch {}
  }
  ring();
  iv = setInterval(ring, 3200);
  return () => { running = false; if (iv) clearInterval(iv); };
}

function playConnectBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 600);
  } catch {}
}

// ── Glass Morphism Control Button ──
function GlassBtn({ onClick, className, children, danger, active, size = 'md' }: {
  onClick: () => void; className?: string; children: React.ReactNode;
  danger?: boolean; active?: boolean; size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-16 h-16' : 'w-13 h-13';
  return (
    <button onClick={onClick}
      className={`${sizeClass} rounded-full flex items-center justify-center press transition-all duration-200 ${className || ''}`}
      style={{
        background: danger
          ? 'rgba(239,68,68,0.85)'
          : active
            ? 'rgba(255,20,147,0.75)'
            : 'rgba(255,255,255,0.12)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.5)' : active ? 'rgba(255,20,147,0.5)' : 'rgba(255,255,255,0.2)'}`,
        boxShadow: danger
          ? '0 4px 20px rgba(239,68,68,0.4)'
          : active
            ? '0 4px 20px rgba(255,20,147,0.4)'
            : '0 2px 8px rgba(0,0,0,0.3)',
      }}>
      {children}
    </button>
  );
}

// ── Incoming Call Overlay — iPhone Style ──
interface IncomingProps {
  call: { id: string; callType: 'audio' | 'video'; caller: UserProfile };
  callBg: { from: string; to: string };
  ringtoneUrl?: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallOverlay({ call, callBg, ringtoneUrl, onAccept, onDecline }: IncomingProps) {
  const stopRef = useRef<(() => void) | null>(null);
  const [pulsate, setPulsate] = useState(false);

  useEffect(() => {
    stopRef.current = createRingtone(ringtoneUrl);
    const t = setTimeout(() => setPulsate(true), 100);
    return () => { stopRef.current?.(); clearTimeout(t); };
  }, []);

  function accept() { stopRef.current?.(); onAccept(); }
  function decline() { stopRef.current?.(); onDecline(); }

  return (
    <div className="fixed inset-0 z-[9900] flex flex-col overflow-hidden"
      style={{
        background: `linear-gradient(180deg, ${callBg.from} 0%, ${callBg.to} 60%, #000 100%)`,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'max(40px, env(safe-area-inset-bottom))',
      }}>

      {/* Background blur circles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(255,20,147,0.8) 0%, transparent 70%)' }} />
        <div className="absolute bottom-1/4 right-0 w-64 h-64 rounded-full opacity-15 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(100,50,255,0.6) 0%, transparent 70%)' }} />
      </div>

      {/* Top info */}
      <div className="relative flex flex-col items-center pt-14 px-6">
        <p className="text-white/60 text-sm font-medium tracking-wide mb-1">
          {call.callType === 'video' ? 'Video Call' : 'Incoming Call'}
        </p>

        {/* Pulse rings + avatar */}
        <div className="relative flex items-center justify-center my-8">
          {/* Outer rings */}
          {pulsate && (
            <>
              <div className="absolute rounded-full border border-white/10 animate-ping"
                style={{ width: 200, height: 200, animationDuration: '2s' }} />
              <div className="absolute rounded-full border border-white/07 animate-ping"
                style={{ width: 240, height: 240, animationDuration: '2.6s', animationDelay: '0.5s' }} />
              <div className="absolute rounded-full border border-white/05 animate-ping"
                style={{ width: 280, height: 280, animationDuration: '3.2s', animationDelay: '1s' }} />
            </>
          )}
          {/* Avatar */}
          <div className="relative z-10 w-36 h-36 rounded-full overflow-hidden"
            style={{
              boxShadow: '0 0 0 4px rgba(255,255,255,0.15), 0 0 0 8px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.5)',
            }}>
            {call.caller.avatar_url
              ? <img src={call.caller.avatar_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full gradient-pink flex items-center justify-center">
                <span className="text-5xl font-black text-white">{(call.caller.username || '?')[0].toUpperCase()}</span>
              </div>
            }
          </div>
        </div>

        <h2 className="text-3xl font-black text-white tracking-tight mb-2">
          {call.caller.username || call.caller.full_name || 'Member'}
        </h2>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <p className="text-white/50 text-sm">{call.callType === 'video' ? 'wants to video call…' : 'calling…'}</p>
        </div>
      </div>

      {/* Swipe hint */}
      <div className="flex-1 flex items-end justify-center pb-2">
        <p className="text-white/25 text-xs">slide to answer</p>
      </div>

      {/* Action buttons — iPhone style */}
      <div className="flex items-center justify-center gap-24 px-8">
        {/* Decline */}
        <div className="flex flex-col items-center gap-3">
          <button onClick={decline}
            className="w-20 h-20 rounded-full flex items-center justify-center press"
            style={{
              background: 'rgba(239,68,68,0.9)',
              boxShadow: '0 6px 30px rgba(239,68,68,0.5)',
              border: '1.5px solid rgba(239,68,68,0.7)',
            }}>
            <PhoneOff className="w-9 h-9 text-white" />
          </button>
          <p className="text-white/60 text-xs font-semibold tracking-wide">Decline</p>
        </div>

        {/* Accept */}
        <div className="flex flex-col items-center gap-3">
          <button onClick={accept}
            className="w-20 h-20 rounded-full flex items-center justify-center press"
            style={{
              background: 'rgba(34,197,94,0.9)',
              boxShadow: '0 6px 30px rgba(34,197,94,0.5)',
              border: '1.5px solid rgba(34,197,94,0.7)',
            }}>
            {call.callType === 'video'
              ? <Video className="w-9 h-9 text-white" />
              : <Phone className="w-9 h-9 text-white" />
            }
          </button>
          <p className="text-white/60 text-xs font-semibold tracking-wide">Accept</p>
        </div>
      </div>
    </div>
  );
}

// ── Active Call Screen — iPhone style ──
interface ActiveCallProps {
  callId: string;
  localUser: { id: string; username?: string; avatar?: string };
  remoteUser: UserProfile;
  callType: 'audio' | 'video';
  isInitiator: boolean;
  callBg: { from: string; to: string };
  onEnd: () => void;
}

export function ActiveCallScreen({ callId, localUser, remoteUser, callType, isInitiator, callBg, onEnd }: ActiveCallProps) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'ended'>('connecting');
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [facingUser, setFacingUser] = useState(true);
  const [isVideo, setIsVideo] = useState(callType === 'video');
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [quality, setQuality] = useState<'good' | 'poor' | 'none'>('none');

  const callIdRef = useRef(callId);
  const isInitiatorRef = useRef(isInitiator);
  const callTypeRef = useRef(callType);
  const onEndRef = useRef(onEnd);
  const isVideoRef = useRef(callType === 'video');

  useEffect(() => { callIdRef.current = callId; }, [callId]);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  useEffect(() => { isVideoRef.current = isVideo; }, [isVideo]);

  const ringbackStopRef = useRef<(() => void) | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasEndedRef = useRef(false);
  const remoteDescSetRef = useRef(false);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const appliedCandidateCount = useRef(0);

  const cleanupRef = useRef<(markStatus?: string) => void>(() => {});
  cleanupRef.current = (markStatus?: string) => {
    if (hasEndedRef.current) return;
    hasEndedRef.current = true;
    ringbackStopRef.current?.();
    if (durationRef.current) { clearInterval(durationRef.current); durationRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    try { pcRef.current?.close(); } catch {}
    if (markStatus) {
      supabase.from('calls').update({ status: markStatus, ended_at: new Date().toISOString() }).eq('id', callIdRef.current).then(() => {});
    }
    setStatus('ended');
    setTimeout(() => onEndRef.current(), 1200);
  };
  function doCleanup(markStatus?: string) { cleanupRef.current(markStatus); }

  const markConnectedRef = useRef(false);
  function markConnected() {
    if (markConnectedRef.current || hasEndedRef.current) return;
    markConnectedRef.current = true;
    ringbackStopRef.current?.();
    ringbackStopRef.current = null;
    playConnectBeep();
    setStatus('connected');
    setQuality('good');
    if (!durationRef.current) {
      durationRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
  }

  async function sendMissedDM(toId: string, fromId: string, type: 'audio' | 'video') {
    const p1 = fromId < toId ? fromId : toId;
    const p2 = fromId < toId ? toId : fromId;
    let { data: conv } = await supabase.from('conversations').select('id').eq('participant_one', p1).eq('participant_two', p2).single();
    if (!conv) {
      const { data: c } = await supabase.from('conversations').insert({ participant_one: p1, participant_two: p2 }).select('id').single();
      conv = c;
    }
    if (conv) {
      const msg = type === 'video' ? '📹 Missed video call' : '📞 Missed call';
      await supabase.from('direct_messages').insert({ conversation_id: conv.id, sender_id: fromId, message: msg });
      await supabase.from('conversations').update({ last_message: msg, last_message_at: new Date().toISOString() }).eq('id', conv.id);
    }
  }

  // Auto-hide controls
  useEffect(() => {
    if (status !== 'connected' || !isVideo) return;
    let t: ReturnType<typeof setTimeout>;
    const reset = () => {
      setShowControls(true);
      clearTimeout(t);
      t = setTimeout(() => setShowControls(false), 4000);
    };
    reset();
    window.addEventListener('touchstart', reset);
    window.addEventListener('click', reset);
    return () => {
      clearTimeout(t);
      window.removeEventListener('touchstart', reset);
      window.removeEventListener('click', reset);
    };
  }, [status, isVideo]);

  useEffect(() => {
    const _callId = callIdRef.current;
    const _isInitiator = isInitiatorRef.current;
    const _callType = callTypeRef.current;

    async function setupCall(withVideo: boolean) {
      if (hasEndedRef.current) return;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          withVideo
            ? { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } }
            : { audio: { echoCancellation: true, noiseSuppression: true }, video: false }
        );
      } catch (err: any) {
        if (hasEndedRef.current) return;
        if (withVideo && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')) {
          toast.error('Camera unavailable — audio only');
          setIsVideo(false); isVideoRef.current = false;
          return setupCall(false);
        }
        toast.error('Microphone access denied.');
        doCleanup('ended'); return;
      }
      if (hasEndedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      localStreamRef.current = stream;
      if (localVideoRef.current && withVideo) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => {});
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        const s = e.streams[0] || new MediaStream([e.track]);
        if (remoteVideoRef.current) { remoteVideoRef.current.srcObject = s; remoteVideoRef.current.muted = false; remoteVideoRef.current.play().catch(() => {}); }
        if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = s; remoteAudioRef.current.muted = false; remoteAudioRef.current.volume = 1.0; remoteAudioRef.current.play().catch(() => {}); }
        markConnected();
      };

      const pendingCands: RTCIceCandidateInit[] = [];
      let batchTimer: ReturnType<typeof setTimeout> | null = null;
      pc.onicecandidate = (e) => {
        if (!e.candidate || hasEndedRef.current) return;
        pendingCands.push(e.candidate.toJSON());
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(async () => {
          const batch = [...pendingCands]; pendingCands.length = 0;
          if (!batch.length || hasEndedRef.current) return;
          const field = _isInitiator ? 'caller_candidates' : 'callee_candidates';
          const { data } = await supabase.from('calls').select(field).eq('id', _callId).single();
          const existing: RTCIceCandidateInit[] = (data as any)?.[field] || [];
          await supabase.from('calls').update({ [field]: [...existing, ...batch] }).eq('id', _callId);
        }, 200);
      };

      pc.oniceconnectionstatechange = () => {
        if (hasEndedRef.current) return;
        const s = pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') { markConnected(); setQuality('good'); }
        else if (s === 'failed') {
          setQuality('poor');
          if (_isInitiator) {
            pc.createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: isVideoRef.current }).then(async offer => {
              if (hasEndedRef.current) return;
              await pc.setLocalDescription(offer);
              remoteDescSetRef.current = false; appliedCandidateCount.current = 0; candidateQueueRef.current = [];
              await supabase.from('calls').update({ offer: JSON.stringify(pc.localDescription), answer: null, callee_candidates: [] }).eq('id', _callId);
            }).catch(() => {});
          }
        } else if (s === 'disconnected') {
          setQuality('poor');
          setTimeout(() => { if (!hasEndedRef.current && pc.iceConnectionState === 'disconnected') doCleanup('ended'); }, 10000);
        }
      };
      pc.onconnectionstatechange = () => { if (!hasEndedRef.current && pc.connectionState === 'connected') { markConnected(); setQuality('good'); } };

      if (_isInitiator) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: withVideo });
        await pc.setLocalDescription(offer);
        await supabase.from('calls').update({ offer: JSON.stringify(pc.localDescription) }).eq('id', _callId);
        if (!hasEndedRef.current) ringbackStopRef.current = createRingtone();
      }

      pollRef.current = setInterval(async () => {
        if (hasEndedRef.current) return;
        const { data } = await supabase.from('calls').select('*').eq('id', _callId).single();
        if (!data) return;
        if (['ended', 'missed', 'declined'].includes(data.status)) { doCleanup(); return; }

        if (!_isInitiator && data.offer && !remoteDescSetRef.current && pc.signalingState === 'stable') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(data.offer)));
            remoteDescSetRef.current = true;
            for (const c of candidateQueueRef.current) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
            candidateQueueRef.current = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await supabase.from('calls').update({ answer: JSON.stringify(pc.localDescription), status: 'active', started_at: new Date().toISOString() }).eq('id', _callId);
          } catch { remoteDescSetRef.current = false; }
        }
        if (_isInitiator && data.answer && !remoteDescSetRef.current && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(data.answer)));
            remoteDescSetRef.current = true;
            for (const c of candidateQueueRef.current) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
            candidateQueueRef.current = [];
          } catch { remoteDescSetRef.current = false; }
        }

        const remoteField = _isInitiator ? 'callee_candidates' : 'caller_candidates';
        const remoteCands: RTCIceCandidateInit[] = (data as any)[remoteField] || [];
        const newCands = remoteCands.slice(appliedCandidateCount.current);
        for (const c of newCands) {
          if (remoteDescSetRef.current) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
          else candidateQueueRef.current.push(c);
        }
        appliedCandidateCount.current = remoteCands.length;
      }, 700);
    }

    setupCall(_callType === 'video');
    return () => {
      ringbackStopRef.current?.();
      if (durationRef.current) clearInterval(durationRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      try { pcRef.current?.close(); } catch {}
    };
  }, []);

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
  }
  function toggleVideo() {
    const next = !videoOff;
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !next; });
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
    if (sender?.track) sender.track.enabled = !next;
    setVideoOff(next);
  }
  async function switchToVideo() {
    if (isVideo) {
      localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = false; t.stop(); });
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) { try { await sender.replaceTrack(null); } catch {} }
      setIsVideo(false); isVideoRef.current = false;
    } else {
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        const vt = vs.getVideoTracks()[0];
        localStreamRef.current?.addTrack(vt);
        const sender = pcRef.current?.getSenders().find(s => !s.track || s.track.kind === 'video');
        if (sender) await sender.replaceTrack(vt);
        else if (pcRef.current && localStreamRef.current) pcRef.current.addTrack(vt, localStreamRef.current);
        if (localVideoRef.current && localStreamRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => {}); }
        setIsVideo(true); isVideoRef.current = true;
      } catch { toast.error('Cannot start video.'); }
    }
  }
  function toggleSpeaker() {
    const next = !speakerOn; setSpeakerOn(next);
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
    if (remoteVideoRef.current) remoteVideoRef.current.muted = !next;
  }
  async function flipCamera() {
    if (!localStreamRef.current) return;
    localStreamRef.current.getVideoTracks().forEach(t => t.stop());
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingUser ? 'environment' : 'user' }, audio: false });
      setFacingUser(!facingUser);
      const newVt = ns.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newVt);
      if (localStreamRef.current) { localStreamRef.current.getVideoTracks().forEach(t => localStreamRef.current!.removeTrack(t)); localStreamRef.current.addTrack(newVt); }
      if (localVideoRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => {}); }
    } catch {}
  }
  async function shareScreen() {
    if (isSharingScreen) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      setIsSharingScreen(false); screenStreamRef.current = null;
      const vt = localStreamRef.current?.getVideoTracks()[0];
      if (vt) { const sv = pcRef.current?.getSenders().find(s => s.track?.kind === 'video'); if (sv) sv.replaceTrack(vt).catch(() => {}); }
      if (localVideoRef.current && localStreamRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => {}); }
      return;
    }
    if (typeof (navigator.mediaDevices as any)?.getDisplayMedia !== 'function') { toast.error('Screen share needs Chrome/Edge desktop.'); return; }
    try {
      const screen = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen; setIsSharingScreen(true);
      const st = screen.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(st).catch(() => {}); else if (pcRef.current) pcRef.current.addTrack(st, screen);
      if (localVideoRef.current) { localVideoRef.current.srcObject = screen; localVideoRef.current.play().catch(() => {}); }
      st.onended = () => {
        setIsSharingScreen(false); screenStreamRef.current = null;
        const vt = localStreamRef.current?.getVideoTracks()[0];
        if (vt) { const sv = pcRef.current?.getSenders().find(s => s.track?.kind === 'video'); if (sv) sv.replaceTrack(vt).catch(() => {}); }
        if (localVideoRef.current && localStreamRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => {}); }
      };
    } catch (err: any) { if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast.error('Screen sharing not available.'); }
  }
  async function endCall() {
    if (status !== 'connected' && !isInitiator) await sendMissedDM(remoteUser.id, localUser.id, callType);
    doCleanup('ended');
  }

  // ── Ended screen ──
  if (status === 'ended') {
    return (
      <div className="fixed inset-0 z-[9800] flex flex-col items-center justify-center"
        style={{ background: `linear-gradient(180deg, ${callBg.from}, ${callBg.to})` }}>
        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
          <PhoneMissed className="w-10 h-10 text-red-400" />
        </div>
        <p className="text-white font-black text-xl mb-1">Call Ended</p>
        {duration > 0 && <p className="text-white/40 text-sm">{formatDuration(duration)}</p>}
      </div>
    );
  }

  // ── Active call ──
  return (
    <div className="fixed inset-0 z-[9800] flex flex-col overflow-hidden"
      style={{
        background: isVideo ? '#000' : `linear-gradient(180deg, ${callBg.from} 0%, ${callBg.to} 100%)`,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
      }}
      onClick={() => isVideo && setShowControls(c => !c)}>
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Remote video full-screen */}
      {isVideo && (
        <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
      )}

      {/* Subtle overlay for video calls */}
      {isVideo && (
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.6) 100%)' }} />
      )}

      {/* Background blur blobs for audio calls */}
      {!isVideo && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full opacity-20 blur-3xl"
            style={{ background: 'radial-gradient(circle, rgba(255,20,147,0.6) 0%, transparent 70%)' }} />
        </div>
      )}

      {/* Top bar */}
      <div className={`relative z-10 flex flex-col items-center pt-10 transition-opacity duration-300 ${isVideo && !showControls ? 'opacity-0' : 'opacity-100'}`}>
        {/* Quality badge */}
        {status === 'connected' && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full mb-2"
            style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
            {quality === 'poor' ? <WifiOff className="w-3 h-3 text-yellow-400" /> : <Wifi className="w-3 h-3 text-green-400" />}
            <span className="text-[10px] text-white/70 font-bold">{quality === 'poor' ? 'Poor connection' : 'Connected'}</span>
          </div>
        )}

        <p className="text-white font-black text-2xl tracking-tight mb-1">{remoteUser.username || remoteUser.full_name || 'Member'}</p>
        <p className="text-white/50 text-sm">
          {status === 'connecting' ? (isInitiator ? '📞 Calling…' : '🔄 Connecting…') : formatDuration(duration)}
        </p>
        {status === 'connecting' && (
          <div className="flex gap-1.5 mt-2">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-white/35 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>

      {/* Audio call avatar */}
      {!isVideo && (
        <div className="relative z-10 flex flex-col items-center mt-8">
          <div className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center"
            style={{ boxShadow: '0 0 0 3px rgba(255,255,255,0.1), 0 0 0 8px rgba(255,255,255,0.05), 0 12px 48px rgba(0,0,0,0.5)' }}>
            {remoteUser.avatar_url
              ? <img src={remoteUser.avatar_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full gradient-pink flex items-center justify-center">
                <span className="text-4xl font-black text-white">{(remoteUser.username || '?')[0].toUpperCase()}</span>
              </div>
            }
          </div>
          {status === 'connecting' && isInitiator && (
            <div className="mt-4 flex gap-1.5">
              {[0,1,2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: `${i*0.2}s` }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Local video PiP — iPhone corner style */}
      {isVideo && (
        <div
          className={`absolute z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-70'}`}
          style={{ top: 'calc(env(safe-area-inset-top) + 80px)', right: 16 }}>
          <div className="w-24 h-36 rounded-2xl overflow-hidden"
            style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.5)', border: '2px solid rgba(255,255,255,0.2)' }}>
            <video ref={localVideoRef} autoPlay playsInline muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)', display: videoOff ? 'none' : 'block' }} />
            {videoOff && (
              <div className="w-full h-full bg-black/80 flex items-center justify-center">
                <CameraOff className="w-6 h-6 text-white/40" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls — iPhone glass morphism bottom bar */}
      <div className={`relative z-10 mt-auto transition-all duration-300 ${isVideo && !showControls ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'}`}>
        {/* Secondary controls row */}
        <div className="flex items-center justify-center gap-5 mb-5 px-8">
          {isVideo && (
            <div className="flex flex-col items-center gap-1.5">
              <GlassBtn onClick={flipCamera} size="sm">
                <RotateCcw className="w-4 h-4 text-white" />
              </GlassBtn>
              <p className="text-white/40 text-[9px]">Flip</p>
            </div>
          )}
          <div className="flex flex-col items-center gap-1.5">
            <GlassBtn onClick={shareScreen} active={isSharingScreen} size="sm">
              <MonitorUp className="w-4 h-4 text-white" />
            </GlassBtn>
            <p className="text-white/40 text-[9px]">Share</p>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <GlassBtn onClick={switchToVideo} active={isVideo} size="sm">
              {isVideo ? <Video className="w-4 h-4 text-white" /> : <VideoOff className="w-4 h-4 text-white/60" />}
            </GlassBtn>
            <p className="text-white/40 text-[9px]">{isVideo ? 'Video' : 'Video'}</p>
          </div>
        </div>

        {/* Main controls */}
        <div className="mx-4 px-6 py-4 rounded-3xl flex items-center justify-between"
          style={{ background: 'rgba(28,28,30,0.88)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {/* Mute */}
          <div className="flex flex-col items-center gap-1.5">
            <GlassBtn onClick={toggleMute} active={muted}>
              {muted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
            </GlassBtn>
            <p className="text-white/40 text-[9px]">{muted ? 'Unmute' : 'Mute'}</p>
          </div>

          {/* Speaker */}
          <div className="flex flex-col items-center gap-1.5">
            <button onClick={toggleSpeaker}
              className="w-13 h-13 rounded-full flex items-center justify-center press"
              style={{
                width: 52, height: 52,
                background: speakerOn ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.2)',
                boxShadow: speakerOn ? '0 4px 20px rgba(255,255,255,0.3)' : '0 2px 8px rgba(0,0,0,0.3)',
              }}>
              {speakerOn ? <Volume2 className="w-5 h-5 text-black" /> : <VolumeX className="w-5 h-5 text-white/60" />}
            </button>
            <p className="text-white/40 text-[9px]">{speakerOn ? 'Speaker' : 'Earpiece'}</p>
          </div>

          {/* End call */}
          <div className="flex flex-col items-center gap-1.5">
            <button onClick={endCall}
              className="flex items-center justify-center press"
              style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'rgba(229,38,61,0.95)',
                boxShadow: '0 6px 28px rgba(229,38,61,0.55)',
                border: '1.5px solid rgba(229,38,61,0.7)',
              }}>
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <p className="text-white/40 text-[9px]">End</p>
          </div>

          {/* Toggle video */}
          <div className="flex flex-col items-center gap-1.5">
            <GlassBtn onClick={toggleVideo} active={videoOff} size="md">
              {videoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
            </GlassBtn>
            <p className="text-white/40 text-[9px]">{videoOff ? 'Video' : 'Video'}</p>
          </div>

          {/* Sparkles (filters placeholder) */}
          <div className="flex flex-col items-center gap-1.5">
            <GlassBtn onClick={() => {}} size="md">
              <Sparkles className="w-5 h-5 text-white/60" />
            </GlassBtn>
            <p className="text-white/40 text-[9px]">Effects</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GlobalCallListener ──
interface PendingCall {
  id: string;
  callType: 'audio' | 'video';
  caller: UserProfile;
}

export function GlobalCallListener() {
  const { user } = useAuth();
  const [incoming, setIncoming] = useState<PendingCall | null>(null);
  const [activeCall, setActiveCall] = useState<{ id: string; remoteUser: UserProfile; callType: 'audio' | 'video'; isInitiator: boolean } | null>(null);
  const [callBg, setCallBg] = useState({ from: '#0d0d1a', to: '#1a0026' });
  const [ringtoneUrl, setRingtoneUrl] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifiedIds = useRef<Set<string>>(new Set());
  const activeCallRef = useRef<typeof activeCall>(null);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

  useEffect(() => {
    supabase.from('call_settings').select('*').eq('id', 'main').single().then(({ data }) => {
      if (data) {
        setCallBg({ from: (data as any).bg_gradient_from || '#0d0d1a', to: (data as any).bg_gradient_to || '#1a0026' });
        setRingtoneUrl((data as any).ringtone_url || '');
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    async function checkIncoming() {
      if (activeCallRef.current) return;
      const since = new Date(Date.now() - 90000).toISOString();
      const { data } = await supabase
        .from('calls')
        .select('id, call_type, status, caller_id, user_profiles!calls_caller_id_fkey(*)')
        .eq('callee_id', user!.id).eq('status', 'ringing')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data && !notifiedIds.current.has(data.id)) {
        notifiedIds.current.add(data.id);
        const caller = (data as any).user_profiles as UserProfile;
        setIncoming({ id: data.id, callType: data.call_type as 'audio' | 'video', caller });
        return;
      }
      if (incoming) {
        const { data: check } = await supabase.from('calls').select('status').eq('id', incoming.id).single();
        if (check && check.status !== 'ringing') setIncoming(null);
      }
    }
    pollRef.current = setInterval(checkIncoming, 1500);
    checkIncoming();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, incoming]);

  async function acceptCall() {
    if (!incoming) return;
    const inc = incoming;
    setIncoming(null);
    setActiveCall({ id: inc.id, remoteUser: inc.caller, callType: inc.callType, isInitiator: false });
  }

  async function declineCall() {
    if (!incoming || !user) return;
    const inc = incoming; setIncoming(null);
    await supabase.from('calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', inc.id);
    const p1 = user.id < inc.caller.id ? user.id : inc.caller.id;
    const p2 = user.id < inc.caller.id ? inc.caller.id : user.id;
    let { data: conv } = await supabase.from('conversations').select('id').eq('participant_one', p1).eq('participant_two', p2).single();
    if (!conv) { const { data: c } = await supabase.from('conversations').insert({ participant_one: p1, participant_two: p2 }).select('id').single(); conv = c; }
    if (conv) {
      const msg = inc.callType === 'video' ? `📹 Missed video call from ${inc.caller.username || 'Member'}` : `📞 Missed call from ${inc.caller.username || 'Member'}`;
      await supabase.from('direct_messages').insert({ conversation_id: conv.id, sender_id: inc.caller.id, message: msg });
      await supabase.from('conversations').update({ last_message: msg, last_message_at: new Date().toISOString() }).eq('id', conv.id);
    }
  }

  return (
    <>
      {incoming && !activeCall && (
        <IncomingCallOverlay call={incoming} callBg={callBg} ringtoneUrl={ringtoneUrl} onAccept={acceptCall} onDecline={declineCall} />
      )}
      {activeCall && user && (
        <ActiveCallScreen
          key={activeCall.id}
          callId={activeCall.id}
          localUser={{ id: user.id, username: user.username, avatar: user.avatar }}
          remoteUser={activeCall.remoteUser}
          callType={activeCall.callType}
          isInitiator={activeCall.isInitiator}
          callBg={callBg}
          onEnd={() => setActiveCall(null)}
        />
      )}
    </>
  );
}

// ── useCall hook ──
export function useCall() {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<{
    id: string; remoteUser: UserProfile; callType: 'audio' | 'video'; isInitiator: boolean;
  } | null>(null);
  const [callBg, setCallBg] = useState({ from: '#0d0d1a', to: '#1a0026' });

  useEffect(() => {
    supabase.from('call_settings').select('*').eq('id', 'main').single().then(({ data }) => {
      if (data) setCallBg({ from: (data as any).bg_gradient_from || '#0d0d1a', to: (data as any).bg_gradient_to || '#1a0026' });
    });
  }, []);

  const startCallRef = useRef<(targetUser: UserProfile, callType: 'audio' | 'video') => Promise<void>>();
  startCallRef.current = async (targetUser: UserProfile, callType: 'audio' | 'video') => {
    if (!user) { toast.error('Please login first'); return; }
    const { data, error } = await supabase.from('calls').insert({
      caller_id: user.id, callee_id: targetUser.id, call_type: callType, status: 'ringing',
    }).select('id').single();
    if (error || !data) { toast.error('Failed to start call'); return; }
    toast.success(`Calling ${targetUser.username || 'member'}…`);

    const autoCancel = setTimeout(async () => {
      const { data: check } = await supabase.from('calls').select('status').eq('id', data.id).single();
      if (check?.status === 'ringing') {
        await supabase.from('calls').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', data.id);
        const p1 = user.id < targetUser.id ? user.id : targetUser.id;
        const p2 = user.id < targetUser.id ? targetUser.id : user.id;
        let { data: conv } = await supabase.from('conversations').select('id').eq('participant_one', p1).eq('participant_two', p2).single();
        if (!conv) { const { data: c } = await supabase.from('conversations').insert({ participant_one: p1, participant_two: p2 }).select('id').single(); conv = c; }
        if (conv) {
          const msg = callType === 'video' ? '📹 Missed video call' : '📞 Missed call';
          await supabase.from('direct_messages').insert({ conversation_id: conv.id, sender_id: user.id, message: msg });
          await supabase.from('conversations').update({ last_message: msg, last_message_at: new Date().toISOString() }).eq('id', conv.id);
        }
        setActiveCall(null);
        toast.error('No answer');
      }
    }, 60000);

    setActiveCall({ id: data.id, remoteUser: targetUser, callType, isInitiator: true });
    return () => clearTimeout(autoCancel) as any;
  };

  const startCall = useCallback((targetUser: UserProfile, callType: 'audio' | 'video') => {
    return startCallRef.current!(targetUser, callType);
  }, []);

  return { startCall, activeCall, setActiveCall, callBg };
}
