{meetingCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 6. Kutuma ujumbe kwenye chat ya ndani
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const now = new Date();
    setMessages([...messages, {
      sender: userName,
      text: newMessage,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);
    setNewMessage('');
  };

  return (
    <div className="w-full h-screen bg-[#202124] text-white flex flex-col font-sans overflow-hidden select-none">
      
      {/* SEHEMU YA KATI: Gridi ya Video na Pembeni (Sidebar) */}
      <div className="flex-1 flex p-4 gap-4 overflow-hidden min-h-0">
        
        {/* GRIDI YA VIDEO (Inajirekebisha kulingana na sidebar) */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 h-full relative items-center justify-center">
          
          {/* Box la 1: Kamera Yako au Screen Share */}
          <div className="bg-[#3c4043] rounded-lg overflow-hidden h-full relative flex items-center justify-center group shadow-md border border-[#5f6368]/20">
            {isVideoOn ? (
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`w-full h-full object-cover ${isSharingScreen ? '' : 'transform scale-x-[-1]'}`}
              />
            ) : (
              <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center text-3xl font-medium shadow-inner uppercase">
                {userName.charAt(0)}
              </div>
            )}
            
            {/* Jina chini ya video */}
            <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded text-sm font-medium flex items-center gap-2">
              {userName} {isSharingScreen && <span className="text-xs text-blue-400">(Unawasilisha kioo)</span>}
              {isMuted && <MicOff size={14} className="text-rose-400" />}
            </div>

            {/* Kiashiria cha Mkono (Hand Raise Indicator) */}
            {hasHandRaised && (
              <div className="absolute top-3 left-3 bg-amber-500 p-2 rounded-full animate-bounce shadow-lg">
                <Hand size={18} className="text-black fill-black" />
              </div>
            )}
          </div>

          {/* Box la 2: Mshiriki wa Mbali (Remote Participant Simulator) */}
          <div className="bg-[#3c4043] rounded-lg overflow-hidden h-full relative flex items-center justify-center shadow-md border border-[#5f6368]/20">
            {/* Simulisha picha ya mshiriki wa pili */}
            <div className="w-20 h-20 bg-emerald-600 rounded-full flex items-center justify-center text-3xl font-medium shadow-inner">
              JS
            </div>
            
            <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded text-sm font-medium flex items-center gap-2">
              Juma Said
            </div>
          </div>

        </div>

        {/* GOOGLE MEET SIDEBAR: Chat, Watu, na Info */}
        {activeSidebar !== 'none' && (
          <div className="w-80 md:w-96 bg-white text-zinc-900 rounded-lg flex flex-col h-full animate-in slide-in-from-right duration-200 shadow-2xl">
            
            {/* Kichwa cha Sidebar */}
            <div className="p-4 border-b border-zinc-200 flex justify-between items-center">
              <h3 className="text-lg font-medium text-zinc-800 uppercase tracking-wide text-sm">
                {activeSidebar === 'chat' && 'In-call Messages'}
                {activeSidebar === 'people' && 'People (2)'}
                {activeSidebar === 'info' && 'Meeting Details'}
              </h3>
              <button 
                onClick={() => setActiveSidebar('none')}
                className="p-2 hover:bg-zinc-100 rounded-full text-zinc-500"
              >
                ✕
              </button>
            </div>

            {/* Maudhui kulingana na tab iliyochaguliwa */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              
              {/* 1. CHAT SIDEBAR */}
              {activeSidebar === 'chat' && (
                <div className="flex flex-col h-full justify-between">
                  <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                    <p className="text-xs bg-amber-50 text-amber-800 p-2 rounded border border-amber-200 flex gap-2">
                      <ShieldAlert size={16} className="shrink-0" />
                      Ujumbe unaotumwa hapa unaonekana tu na watu waliopo kwenye simu kwa sasa na hufutwa mkiondoka.
                    </p>
                    {messages.map((msg, idx) => (
                      <div key={idx} className="text-sm">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-zinc-800">{msg.sender}</span>
                          <span className="text-xs text-zinc-400">{msg.time}</span>
                        </div>
                        <p className="text-zinc-600 mt-1 break-words">{msg.text}</p>
                      </div>
                    ))}
                  </div>
                  
                  <form onSubmit={sendMessage} className="mt-4 flex gap-2 border-t pt-3 border-zinc-100">
                    <input 
                      type="text" 
                      placeholder="Tuma ujumbe kwa kila mtu..."
                      value={newMessage}
