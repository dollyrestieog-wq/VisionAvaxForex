import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, X, Volume2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────
interface RemoteUser {
  id: string;
  username?: string;
  avatar?: string | null;
}

interface ActiveCallState {
  id: string;
  remoteUser: RemoteUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
}

interface CallRecord {
  id: string;
  caller_id: string;
  callee_id: string;
  call_type: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'declined' | 'missed';
  offer?: string;
  answer?: string;
  caller_candidates?: any[];
  callee_candidates?: any[];
}

// ── Context / shared state via module-level ref ────────────────────────────
// We use a simple pub/sub to share call state between useCall and GlobalCallListener
type CallStateListener = (state: ActiveCallState | null) => void;
const callStateListeners = new Set<CallStateListener>();
let globalCallState: ActiveCallState | null = null;
let globalCallBg = 'linear-gradient(160deg, #0a0a1a 0%, #120020 100%)';

function setGlobalCallState(state: ActiveCallState | null) {
  globalCallState = state;
  callStateListeners.forEach(fn => fn(state));
}

// ── useCall hook ────────────────────────────────────────────────────────────
export function useCall() {
  const { user } = useAuth();
  const [activeCall, setActiveCallLocal] = useState<ActiveCallState | null>(globalCallState);
  const [callBg, setCallBg] = useState(globalCallBg);

  // Load call settings
  useEffect(() => {
    supabase.from('call_settings').select('bg_gradient_from,bg_gradient_to').eq('id', 'main').single().then(({ data }) => {
      if (data) {
        const from = (data as any).bg_gradient_from || '#0d0d1a';
        const to = (data as any).bg_gradient_to || '#1a0026';
        globalCallBg = `linear-gradient(160deg, ${from} 0%, ${to} 100%)`;
        setCallBg(globalCallBg);
      }
    });
  }, []);

  useEffect(() => {
    const listener: CallStateListener = (state) => setActiveCallLocal(state);
    callStateListeners.add(listener);
    return () => { callStateListeners.delete(listener); };
  }, []);

  const setActiveCall = useCallback((state: ActiveCallState | null) => {
    setGlobalCallState(state);
    setActiveCallLocal(state);
  }, []);

  const startCall = useCallback(async (remoteUser: RemoteUser, callType: 'audio' | 'video') => {
    if (!user) { toast.error('Login required'); return; }

    // Insert call record
    const { data: callRecord, error } = await supabase.from('calls').insert({
      caller_id: user.id,
      callee_id: remoteUser.id,
      call_type: callType,
      status: 'ringing',
    }).select().single();

    if (error || !callRecord) { toast.error('Could not start call'); return; }

    setGlobalCallState({
      id: callRecord.id,
      remoteUser,
      callType,
      isInitiator: true,
    });
  }, [user]);

  return { startCall, activeCall, setActiveCall, callBg };
}

// ── Incoming Call Screen ───────────────────────────────────────────────────
function IncomingCallScreen({ callRecord, caller, callBg, onAccept, onDecline }: {
  callRecord: CallRecord;
  caller: RemoteUser;
  callBg: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setCount(c => c + 1), 1000);
    // Auto-decline after 30s
    const timeout = setTimeout(() => { onDecline(); }, 30000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, []);

  return (
    <div className="fixed inset-0 z-[900] flex flex-col items-center justify-between overflow-hidden" style={{ background: callBg }}>
      {/* Pulse rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="absolute rounded-full border border-white/10"
            style={{
              width: `${180 + i * 70}px`,
              height: `${180 + i * 70}px`,
              animation: `ping 2s ease-out ${i * 0.6}s infinite`,
              opacity: 0.4 - i * 0.1,
            }}
          />
        ))}
      </div>

      {/* Top section */}
      <div className="flex flex-col items-center pt-20 z-10">
        <p className="text-white/60 text-sm font-medium mb-2">
          Incoming {callRecord.call_type === 'video' ? 'Video' : 'Voice'} Call
        </p>
        <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-white/20 mb-4 gradient-pink flex items-center justify-center" style={{ boxShadow: '0 0 40px rgba(255,20,147,0.4)' }}>
          {caller.avatar
            ? <img src={caller.avatar} alt="" className="w-full h-full object-cover" />
            : <span className="text-3xl font-black text-white">{(caller.username || '?')[0].toUpperCase()}</span>
          }
        </div>
        <h2 className="text-2xl font-black text-white mb-1">{caller.username || 'Unknown'}</h2>
        <p className="text-white/50 text-sm">
          {callRecord.call_type === 'video' ? '📹' : '📞'} calling you...
        </p>
      </div>

      {/* Bottom buttons */}
      <div className="flex items-center justify-center gap-16 pb-16 z-10">
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onDecline}
            className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center press shadow-lg"
            style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.6)' }}
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
          <span className="text-white/50 text-xs">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onAccept}
            className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center press shadow-lg"
            style={{ boxShadow: '0 4px 24px rgba(34,197,94,0.6)', animation: 'pulse 1.5s ease-in-out infinite' }}
          >
            {callRecord.call_type === 'video' ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
          </button>
          <span className="text-white/50 text-xs">Accept</span>
        </div>
      </div>
    </div>
  );
}

// ── Active Call Screen (exported) ──────────────────────────────────────────
export function ActiveCallScreen({ callId, localUser, remoteUser, callType, isInitiator, callBg, onEnd }: {
  callId: string;
  localUser: { id: string; username?: string; avatar?: string | null };
  remoteUser: RemoteUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
  callBg: string;
  onEnd: () => void;
}) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const endCall = useCallback(async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId);
    onEnd();
  }, [callId, onEnd]);

  useEffect(() => {
    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === 'video',
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        stream.getTracks().forEach(t => pc.addTrack(t, stream));

        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;
        pc.ontrack = (event) => {
          event.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
          setCallStatus('active');
          timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
        };

        if (isInitiator) {
          // Collect candidates and store in DB
          const candidateBuffer: RTCIceCandidateInit[] = [];
          pc.onicecandidate = (event) => {
            if (event.candidate) candidateBuffer.push(event.candidate.toJSON());
          };
          pc.onicegatheringstatechange = async () => {
            if (pc.iceGatheringState === 'complete' && candidateBuffer.length > 0) {
              await supabase.from('calls').update({ caller_candidates: candidateBuffer }).eq('id', callId);
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await supabase.from('calls').update({ offer: JSON.stringify(offer), status: 'ringing' }).eq('id', callId);
          setCallStatus('ringing');

          // Poll for answer
          const pollAnswer = setInterval(async () => {
            if (doneRef.current) { clearInterval(pollAnswer); return; }
            const { data } = await supabase.from('calls').select('answer, callee_candidates, status').eq('id', callId).single();
            if (!data) return;
            if (data.status === 'ended' || data.status === 'declined') { clearInterval(pollAnswer); endCall(); return; }
            if (data.answer && !pc.currentRemoteDescription) {
              await pc.setRemoteDescription(JSON.parse(data.answer));
              if (data.callee_candidates) {
                for (const c of data.callee_candidates) {
                  await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
                }
              }
              clearInterval(pollAnswer);
            }
          }, 1500);
        } else {
          // Callee: read offer, create answer
          const { data: callData } = await supabase.from('calls').select('offer, caller_candidates').eq('id', callId).single();
          if (!callData?.offer) { endCall(); return; }

          await pc.setRemoteDescription(JSON.parse(callData.offer));
          if (callData.caller_candidates) {
            for (const c of callData.caller_candidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
          }

          const candidateBuffer: RTCIceCandidateInit[] = [];
          pc.onicecandidate = (event) => {
            if (event.candidate) candidateBuffer.push(event.candidate.toJSON());
          };
          pc.onicegatheringstatechange = async () => {
            if (pc.iceGatheringState === 'complete' && candidateBuffer.length > 0) {
              await supabase.from('calls').update({ callee_candidates: candidateBuffer }).eq('id', callId);
            }
          };

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await supabase.from('calls').update({ answer: JSON.stringify(answer), status: 'active' }).eq('id', callId);
          setCallStatus('active');
          timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
        }
      } catch (err) {
        console.error('Call setup error:', err);
        toast.error('Could not access camera/microphone');
        endCall();
      }
    }

    setup();
    return () => {
      doneRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      pcRef.current?.close();
    };
  }, []);

  function toggleMic() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled); }
  }

  function toggleCam() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCamOn(track.enabled); }
  }

  const statusLabel = callStatus === 'ringing' ? 'Ringing...' : callStatus === 'connecting' ? 'Connecting...' : callStatus === 'ended' ? 'Call ended' : formatDuration(callDuration);

  return (
    <div className="fixed inset-0 z-[800] flex flex-col overflow-hidden" style={{ background: callBg }}>
      {/* Remote video */}
      {callType === 'video' && (
        <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
      )}

      {/* Avatar fallback when no video */}
      {(callType === 'audio' || callStatus !== 'active') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* Pulse rings */}
          <div className="relative flex items-center justify-center mb-8">
            {callStatus !== 'active' && [0, 1, 2].map(i => (
              <div key={i} className="absolute rounded-full border border-white/10"
                style={{ width: `${160 + i * 60}px`, height: `${160 + i * 60}px`, animation: `ping 2s ease-out ${i * 0.5}s infinite`, opacity: 0.3 }} />
            ))}
            <div className="w-28 h-28 rounded-full overflow-hidden ring-4 ring-white/20 relative z-10 gradient-pink flex items-center justify-center"
              style={{ boxShadow: '0 0 40px rgba(255,20,147,0.4)' }}>
              {remoteUser.avatar
                ? <img src={remoteUser.avatar} alt="" className="w-full h-full object-cover" />
                : <span className="text-4xl font-black text-white">{(remoteUser.username || '?')[0].toUpperCase()}</span>
              }
            </div>
          </div>
          <h2 className="text-2xl font-black text-white mb-2">{remoteUser.username || 'Member'}</h2>
          <p className="text-white/50 text-base">{statusLabel}</p>
        </div>
      )}

      {/* Active audio status */}
      {callType === 'audio' && callStatus === 'active' && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <p className="text-white/60 text-sm mt-4">{statusLabel}</p>
        </div>
      )}

      {/* Local video PiP */}
      {callType === 'video' && (
        <div className="absolute top-16 right-4 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/20 z-10 bg-gray-900"
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          {!camOn && (
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
              <VideoOff className="w-6 h-6 text-white/40" />
            </div>
          )}
        </div>
      )}

      {/* Video active status overlay */}
      {callType === 'video' && callStatus === 'active' && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-center pt-4 z-10"
          style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
          <div className="px-4 py-1.5 rounded-full bg-black/50 backdrop-blur-sm">
            <p className="text-white text-sm font-bold">{statusLabel}</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center pb-safe z-20"
        style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))' }}>
        {/* Remote name for video */}
        {callType === 'video' && callStatus === 'active' && (
          <p className="text-white/70 text-sm font-bold mb-6">{remoteUser.username || 'Member'}</p>
        )}

        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-1.5">
            <button onClick={toggleMic}
              className={`w-14 h-14 rounded-full flex items-center justify-center press transition-all ${micOn ? 'bg-white/15 border border-white/20' : 'bg-red-500'}`}
              style={{ backdropFilter: 'blur(12px)' }}>
              {micOn ? <Mic className="w-6 h-6 text-white" /> : <MicOff className="w-6 h-6 text-white" />}
            </button>
            <span className="text-white/50 text-xs">{micOn ? 'Mute' : 'Unmute'}</span>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <button onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center press shadow-2xl"
              style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.7)' }}>
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <span className="text-white/50 text-xs">End</span>
          </div>

          {callType === 'video' ? (
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={toggleCam}
                className={`w-14 h-14 rounded-full flex items-center justify-center press transition-all ${camOn ? 'bg-white/15 border border-white/20' : 'bg-red-500'}`}
                style={{ backdropFilter: 'blur(12px)' }}>
                {camOn ? <Video className="w-6 h-6 text-white" /> : <VideoOff className="w-6 h-6 text-white" />}
              </button>
              <span className="text-white/50 text-xs">{camOn ? 'Camera off' : 'Camera on'}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <button className="w-14 h-14 rounded-full bg-white/15 border border-white/20 flex items-center justify-center press"
                style={{ backdropFilter: 'blur(12px)' }}>
                <Volume2 className="w-6 h-6 text-white" />
              </button>
              <span className="text-white/50 text-xs">Speaker</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── GlobalCallListener ────────────────────────────────────────────────────
export function GlobalCallListener() {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<{ record: CallRecord; caller: RemoteUser } | null>(null);
  const [activeCall, setActiveCallState] = useState<ActiveCallState | null>(null);
  const [callBg, setCallBg] = useState('linear-gradient(160deg, #0a0a1a 0%, #120020 100%)');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handledCallIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    supabase.from('call_settings').select('bg_gradient_from,bg_gradient_to').eq('id', 'main').single().then(({ data }) => {
      if (data) {
        const from = (data as any).bg_gradient_from || '#0d0d1a';
        const to = (data as any).bg_gradient_to || '#1a0026';
        globalCallBg = `linear-gradient(160deg, ${from} 0%, ${to} 100%)`;
        setCallBg(globalCallBg);
      }
    });
  }, []);

  // Subscribe to global call state changes from useCall
  useEffect(() => {
    const listener: CallStateListener = (state) => setActiveCallState(state);
    callStateListeners.add(listener);
    return () => { callStateListeners.delete(listener); };
  }, []);

  // Poll for incoming calls
  useEffect(() => {
    if (!user) return;
    const poll = async () => {
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('callee_id', user.id)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !handledCallIds.current.has(data.id)) {
        // Fetch caller info
        const { data: callerProfile } = await supabase
          .from('user_profiles')
          .select('id, username, avatar_url')
          .eq('id', data.caller_id)
          .single();

        setIncomingCall({
          record: data as CallRecord,
          caller: {
            id: data.caller_id,
            username: callerProfile?.username || 'Unknown',
            avatar: callerProfile?.avatar_url || null,
          },
        });
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user]);

  async function acceptCall() {
    if (!incomingCall || !user) return;
    const callId = incomingCall.record.id;
    handledCallIds.current.add(callId);
    setIncomingCall(null);

    setGlobalCallState({
      id: callId,
      remoteUser: incomingCall.caller,
      callType: incomingCall.record.call_type,
      isInitiator: false,
    });
    setActiveCallState(globalCallState);
  }

  async function declineCall() {
    if (!incomingCall) return;
    handledCallIds.current.add(incomingCall.record.id);
    await supabase.from('calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', incomingCall.record.id);
    setIncomingCall(null);
  }

  return (
    <>
      {incomingCall && !activeCall && (
        <IncomingCallScreen
          callRecord={incomingCall.record}
          caller={incomingCall.caller}
          callBg={callBg}
          onAccept={acceptCall}
          onDecline={declineCall}
        />
      )}
      {activeCall && user && !incomingCall && (
        <ActiveCallScreen
          callId={activeCall.id}
          localUser={{ id: user.id, username: user.username, avatar: user.avatar }}
          remoteUser={activeCall.remoteUser}
          callType={activeCall.callType}
          isInitiator={activeCall.isInitiator}
          callBg={callBg}
          onEnd={() => { setGlobalCallState(null); setActiveCallState(null); }}
        />
      )}
    </>
  );
}

// ── Default export ─────────────────────────────────────────────────────────
export default function WebRTCCall() {
  return null;
}
