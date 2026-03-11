/**
 * Kaira Bot Tab View
 * Main view with Chat and Trace Analysis tabs (similar to Voice Rx pattern)
 */

import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef } from "react";
import { Spinner, Tabs } from "@/components/ui";
import { ChatView } from "@/features/kaira/components/ChatView";
import { TraceAnalysisView } from "@/features/kaira/components";
import { KairaBotEvaluatorsView } from "@/features/kaira/components/KairaBotEvaluatorsView";
import { useKairaChat } from "@/hooks";
import { routes } from "@/config/routes";

export function KairaBotTabView() {
  const [searchParams] = useSearchParams();
  const { chatId: chatIdFromUrl } = useParams<{ chatId?: string }>();
  const navigate = useNavigate();

  const {
    currentSession,
    messages,
    isSessionsLoaded,
    isLoadingSessions,
    isLoadingMessages,
    sessions,
    selectSession,
  } = useKairaChat({ chatIdHint: chatIdFromUrl });

  // Get active tab from URL or default to 'chat'
  const activeTab = searchParams.get("tab") || "chat";

  const handleTabChange = useCallback(
    (tabId: string) => {
      if (currentSession) {
        navigate(`${routes.kaira.chatSession(currentSession.id)}?tab=${tabId}`);
      } else {
        navigate(`${routes.kaira.chat}?tab=${tabId}`);
      }
    },
    [currentSession, navigate],
  );

  // ── Bidirectional URL ↔ Store sync (single effect to prevent ping-pong) ──
  //
  // Possible states once sessions are loaded:
  //
  // 1. URL has no chatId  → store auto-selected a session → push store → URL (replace)
  // 2. URL chatId matches store → in sync, nothing to do
  // 3. URL chatId is valid but differs from store → URL wins → call selectSession
  // 4. URL chatId is invalid (not in sessions list) → store wins → replace URL
  // 5. currentSession is null + chatId in URL → session deleted → navigate to first remaining or base
  //
  const prevChatIdFromUrlRef = useRef(chatIdFromUrl);

  useEffect(() => {
    if (!isSessionsLoaded || isLoadingSessions) return;

    const tab = searchParams.get("tab") || "chat";
    const urlChanged = chatIdFromUrl !== prevChatIdFromUrlRef.current;
    prevChatIdFromUrlRef.current = chatIdFromUrl;

    // Case 5: currentSession is null but URL has a chatId
    // Subcases: (a) chatId is valid → just select it; (b) chatId is stale (deleted) → redirect
    if (!currentSession && chatIdFromUrl) {
      const chatIdIsValid = sessions.some((s) => s.id === chatIdFromUrl);
      if (chatIdIsValid) {
        // (a) Session exists but store lost track (e.g. page remount) → select it
        selectSession(chatIdFromUrl);
      } else if (sessions.length > 0) {
        // (b) Stale chatId (session was deleted) → redirect to first remaining session
        const nextId = sessions[0].id;
        selectSession(nextId);
        navigate(`${routes.kaira.chatSession(nextId)}?tab=${tab}`, {
          replace: true,
        });
      } else {
        navigate(`${routes.kaira.chat}?tab=${tab}`, { replace: true });
      }
      return;
    }

    // Nothing to do if store has no session (edge: brand-new user with 0 sessions)
    if (!currentSession) return;

    // Case 2: already in sync
    if (currentSession.id === chatIdFromUrl) return;

    // Case 1: no chatId in URL (initial load / bare /kaira/chat) → sync URL to store
    if (!chatIdFromUrl) {
      navigate(`${routes.kaira.chatSession(currentSession.id)}?tab=${tab}`, {
        replace: true,
      });
      return;
    }

    // chatIdFromUrl exists and differs from currentSession.id
    const chatIdIsValid = sessions.some((s) => s.id === chatIdFromUrl);

    // Case 3: URL chatId is valid AND the URL just changed → URL is the driver → select in store
    if (chatIdIsValid && urlChanged) {
      selectSession(chatIdFromUrl);
      return;
    }

    // Case 4: URL chatId is invalid (stale bookmark, etc.) → store wins → replace URL
    if (!chatIdIsValid) {
      navigate(`${routes.kaira.chatSession(currentSession.id)}?tab=${tab}`, {
        replace: true,
      });
      return;
    }

    // Remaining: chatIdIsValid && !urlChanged → store changed externally (e.g. createSession
    // updated currentSessionId before the navigate call completes). Don't fight it — the
    // Sidebar/caller will issue its own navigate() momentarily.
  }, [
    currentSession,
    chatIdFromUrl,
    searchParams,
    navigate,
    isSessionsLoaded,
    isLoadingSessions,
    sessions,
    selectSession,
  ]);

  // Settled = sessions fetched + a session selected + its messages loaded.
  // sessions.length === 0 covers new users: no session will ever be selected,
  // so don't wait for one — let the tabs render (ChatView will auto-create).
  const isReady =
    isSessionsLoaded &&
    !isLoadingSessions &&
    !isLoadingMessages &&
    (sessions.length === 0 || currentSession !== null);

  if (!isReady) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-center flex-1">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const tabs = [
    {
      id: "chat",
      label: "Chat",
      content: <ChatView />,
    },
    {
      id: "traces",
      label: "Traces",
      content: (
        <TraceAnalysisView session={currentSession} messages={messages} />
      ),
    },
    {
      id: "evaluators",
      label: "Evaluators",
      content: (
        <KairaBotEvaluatorsView session={currentSession} messages={messages} />
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <Tabs
        tabs={tabs}
        defaultTab={activeTab}
        onChange={handleTabChange}
        fillHeight
      />
    </div>
  );
}
