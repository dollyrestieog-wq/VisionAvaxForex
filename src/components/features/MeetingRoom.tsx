import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video, VideoOff, Mic, MicOff, PhoneOff, Users,
  Monitor, X, Crown, Maximize2, Settings
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Meeting {
  id: string;
  host_id: string;
  title: string;
  status: 'waiting' | 'active' | 'ended';
  participants: string[];
  started_at?: string;
  ended_at?: string;
  created_at: string;
}

interface Participant {
  id: string;
  username?: string;
  avatar_url?: string;
  is_online?: boolean;
}

// ── ICE / STUN config ──────────────────────────────────────────────────────────

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ── MeetingJoinButton ──────────────────────────────────────────────────────────
// Rendered inside a VIP chat message bubble

export function MeetingJoinButton({ meetingId, title }: { meetingId: string; title: string }) {
  const { user } = useAuth();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [joining, setJoining] = useState(false);
  const [inMeeting, setInMeeting] = useState(false);

  useEffect(() => {
    supabase.from('meetings').select('*').eq('id', meetingId).single()
      .then(({ data }) => { if (data) setMeeting(data as Meeting); });
  }, [meetingId]);

  if (!meeting || meeting.status === 'ended') {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/40 rounded-xl border border-border/50">
        <Video className="w-4 h-4 text-muted-foreground" />
        <div>
          <p className="text-xs font-bold text-muted-foreground">{title}</p>
          <p className="text-[10px] text-muted-foreground/60">Meeting ended</p>
        </div>
      </div>
    );
  }

  async function join() {
    if (!user || !meeting) return;
    setJoining(true);
    const participants: string[] = Array.isArray(meeting.participants) ? meeting.participants : [];
    if (!participants.includes(user.id)) {
      await supabase.from('meetings').update({
        participants: [...participants, user.id],
        status: 'active',
        started_at: meeting.started_at || new Date().toISOString(),
      }).eq('id', meeting.id);
    }
    setInMeeting(true);
    setJoining(false);
  }

  if (inMeeting) {
    return <ActiveMeetingRoom meetingId={meetingId} title={title} onLeave={() => setInMeeting(false)} />;
  }

  const participantCount = Array.isArray(meeting.participants) ? meeting.participants.length : 0;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-primary/10 rounded-xl border border-primary/25">
      <div className="w-9 h-9 gradient-pink rounded-xl flex items-center justify-center flex-shrink-0">
        <Video className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-black text-foreground truncate">{title}</p>
        <p className="text-[10px] text-muted-foreground">
          {meeting.status === 'active' ? `${participantCount} participant${participantCount !== 1 ? 's' : ''} • Live` : 'Waiting to start'}
        </p>
      </div>
      <button
        onClick={join}
        disabled={joining}
        className="px-3 py-1.5 gradient-pink rounded-lg text-white text-xs font-bold press pink-glow-xs disabled:opacity-50 flex-shrink-0"
      >
        {joining ? '...' : 'Join'}
      </button>
    </div>
  );
}

// ── ActiveMeetingRoom ──────────────────────────────────────────────────────────
// Full-screen meeting UI shown after joining

function ActiveMeetingRoom({
  meetingId,
  title,
  onLeave,
}: {
  meetingId: string;
  title: string;
  onLeave: () => void;
}) {
  const { user, profile } = useAuth();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantCount, setParticipantCount] = useState(1);
  const [showParticipants, setShowParticipants] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const controlHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  // Auto-hide controls
  function resetControlTimer() {
    setControlsVisible(true);
    if (controlHideTimer.current) clearTimeout(controlHideTimer.current);
    controlHideTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  }

  // Get local media
  useEffect(() => {
    doneRef.current = false;
    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err: unknown) {
        const e = err as Error;
        if (e.name === 'NotAllowedError') {
          toast.error('Camera/mic permission denied');
        } else {
          console.warn('Media error:', e.message);
        }
      }
    }
    initMedia();
    resetControlTimer();

    return () => {
      doneRef.current = true;
      if (controlHideTimer.current) clearTimeout(controlHideTimer.current);
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      // Fire-and-forget: end meeting on host leave
      if (user) {
        supabase.from('meetings')
          .select('host_id, participants')
          .eq('id', meetingId)
          .single()
          .then(({ data }) => {
            if (!data) return;
            const remaining = (data.participants as string[]).filter((id: string) => id !== user.id);
            if (data.host_id === user.id || remaining.length === 0) {
              supabase.from('meetings').update({
                status: 'ended',
                ended_at: new Date().toISOString(),
              }).eq('id', meetingId).then(() => {});
            } else {
              supabase.from('meetings').update({ participants: remaining }).eq('id', meetingId).then(() => {});
            }
          });
      }
    };
  }, [meetingId, user?.id]);

  // Poll participants
  const fetchParticipants = useCallback(async () => {
    const { data: meeting } = await supabase.from('meetings').select('participants').eq('id', meetingId).single();
    if (!meeting) return;
    const ids: string[] = Array.isArray(meeting.participants) ? meeting.participants : [];
    setParticipantCount(ids.length);
    if (ids.length > 0) {
      const { data: profiles } = await supabase.from('user_profiles').select('id, username, avatar_url, is_online').in('id', ids);
      if (profiles) setParticipants(profiles as Participant[]);
    } else {
      setParticipants([]);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchParticipants();
    pollRef.current = setInterval(fetchParticipants, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchParticipants]);

  function toggleMic() {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    setMicOn(v => !v);
  }

  function toggleCam() {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !camOn; });
    setCamOn(v => !v);
  }

  async function leaveMeeting() {
    onLeave();
  }

  const username = (profile as any)?.username || (user as any)?.username || 'You';
  const avatarUrl = (profile as any)?.avatar_url;

  return (
    <div
      className="fixed inset-0 z-[600] flex flex-col"
      style={{ background: 'linear-gradient(160deg, #0d0d1a 0%, #1a0026 100%)' }}
      onClick={resetControlTimer}
      onTouchStart={resetControlTimer}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 flex-shrink-0 transition-opacity duration-300"
        style={{
          paddingTop: 'max(14px, env(safe-area-inset-top))',
          paddingBottom: '10px',
          opacity: controlsVisible ? 1 : 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, transparent 100%)',
        }}
      >
        <div>
          <p className="text-white font-black text-sm">{title}</p>
          <p className="text-white/50 text-xs">{participantCount} participant{participantCount !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowParticipants(v => !v)}
          className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center press"
        >
          <Users className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Main video area */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        {/* Remote participants grid */}
        {participants.filter(p => p.id !== user?.id).length > 0 ? (
          <div
            className="w-full h-full grid gap-1 p-1"
            style={{
              gridTemplateColumns: participants.length <= 2 ? '1fr' : 'repeat(2, 1fr)',
            }}
          >
            {participants
              .filter(p => p.id !== user?.id)
              .map(p => (
                <div
                  key={p.id}
                  className="relative rounded-2xl overflow-hidden bg-[#111] flex items-center justify-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center">
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl font-black text-white">
                          {(p.username || '?')[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="text-white/80 text-xs font-bold">{p.username || 'Member'}</p>
                  </div>
                  {p.is_online && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-400" />
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 opacity-50">
            <Users className="w-12 h-12 text-white/30" />
            <p className="text-white/40 text-sm">Waiting for others to join…</p>
          </div>
        )}

        {/* Local video PiP */}
        <div
          className="absolute bottom-4 right-4 w-24 rounded-2xl overflow-hidden border-2 border-primary/40 shadow-2xl"
          style={{ aspectRatio: '9/16', maxHeight: 160, background: '#111' }}
        >
          {camOn ? (
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <span className="text-lg font-black text-white">{username[0]?.toUpperCase()}</span>
              )}
              <p className="text-white/60 text-[9px] font-bold">You</p>
            </div>
          )}
          <div className="absolute bottom-1 left-0 right-0 flex justify-center">
            <span className="text-[8px] text-white/60 font-bold px-1 bg-black/40 rounded">{username}</span>
          </div>
        </div>
      </div>

      {/* Participants panel */}
      {showParticipants && (
        <div
          className="absolute top-0 right-0 bottom-0 w-64 bg-card/95 border-l border-border z-10 overflow-y-auto animate-slide-left"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="font-black text-foreground text-sm">Participants ({participantCount})</p>
            <button onClick={() => setShowParticipants(false)} className="p-1 rounded-lg bg-muted press">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="p-2">
            {participants.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-muted/50">
                <div className="relative w-9 h-9 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center flex-shrink-0">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-black text-white">{(p.username || '?')[0].toUpperCase()}</span>
                  )}
                  {p.is_online && (
                    <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-400 border border-background" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{p.username || 'Member'}</p>
                  {p.id === user?.id && <p className="text-[10px] text-primary">You</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        className="flex-shrink-0 flex items-center justify-center gap-4 transition-opacity duration-300"
        style={{
          opacity: controlsVisible ? 1 : 0,
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
          paddingTop: '16px',
          background: 'linear-gradient(0deg, rgba(0,0,0,0.7) 0%, transparent 100%)',
        }}
      >
        <button
          onClick={toggleMic}
          className="w-14 h-14 rounded-full flex items-center justify-center press transition-colors"
          style={{ background: micOn ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.7)' }}
        >
          {micOn ? <Mic className="w-6 h-6 text-white" /> : <MicOff className="w-6 h-6 text-white" />}
        </button>

        <button
          onClick={leaveMeeting}
          className="w-16 h-16 rounded-full flex items-center justify-center press shadow-2xl"
          style={{ background: '#ef4444' }}
        >
          <PhoneOff className="w-7 h-7 text-white" />
        </button>

        <button
          onClick={toggleCam}
          className="w-14 h-14 rounded-full flex items-center justify-center press transition-colors"
          style={{ background: camOn ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.7)' }}
        >
          {camOn ? <Video className="w-6 h-6 text-white" /> : <VideoOff className="w-6 h-6 text-white" />}
        </button>
      </div>
    </div>
  );
}

// ── useCreateMeeting hook ──────────────────────────────────────────────────────
// Used in VIPRoom to create meetings and inject a message with meeting_id

export function useCreateMeeting() {
  const { user } = useAuth();
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [activeMeetingTitle, setActiveMeetingTitle] = useState('VIP Meeting');

  const createMeeting = useCallback(async (title = 'VIP Meeting') => {
    if (!user) return;
    const { data, error } = await supabase.from('meetings').insert({
      host_id: user.id,
      title,
      status: 'waiting',
      participants: [user.id],
    }).select().single();

    if (error || !data) {
      toast.error('Failed to create meeting');
      return;
    }

    // Post a join-link message in VIP room
    await supabase.from('vip_messages').insert({
      user_id: user.id,
      message: `**${title}** — Join the live meeting!\nmeeting_id:${data.id}`,
      is_announcement: false,
    });

    setActiveMeetingTitle(title);
    setActiveMeetingId(data.id);
    toast.success('Meeting created! Others can now join.');
  }, [user]);

  // MeetingComponent renders the active room when host is in meeting
  const MeetingComponent: React.FC = useCallback(() => {
    if (!activeMeetingId) return null;
    return (
      <ActiveMeetingRoom
        meetingId={activeMeetingId}
        title={activeMeetingTitle}
        onLeave={() => setActiveMeetingId(null)}
      />
    );
  }, [activeMeetingId, activeMeetingTitle]);

  return { createMeeting, MeetingComponent };
}
