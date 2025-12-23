import { useState, useEffect, useRef, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { Cross2Icon, CheckIcon } from "@radix-ui/react-icons";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";

// ============================================================================
// Logo Component
// ============================================================================

function NotifierLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="-127 -80 1240 1240" className={className} fill="currentColor">
      <path d="M281.73,892.18V281.73C281.73,126.13,155.6,0,0,0l0,0v610.44C0,766.04,126.13,892.18,281.73,892.18z"/>
      <path d="M633.91,1080V469.56c0-155.6-126.13-281.73-281.73-281.73l0,0v610.44C352.14,953.87,478.31,1080,633.91,1080L633.91,1080z"/>
      <path d="M704.32,91.16L704.32,91.16v563.47l0,0c155.6,0,281.73-126.13,281.73-281.73S859.92,91.16,704.32,91.16z"/>
    </svg>
  );
}

// ============================================================================
// MiniSwitch Component
// ============================================================================

function MiniSwitch({ checked, onChange, label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="flex items-center gap-1.5 text-xs"
      title={label}
    >
      <div
        className={`relative w-7 h-4 rounded-full transition-colors ${
          checked ? "bg-white/40" : "bg-white/15"
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </div>
      {label && <span className="opacity-70">{label}</span>}
    </button>
  );
}

// ============================================================================
// Types
// ============================================================================

export interface ReviewItem {
  id: string;
  seq: number;
  title: string;
  project?: string;
  timestamp: number;
  tmux_session?: string;
  tmux_window?: string;
  tmux_pane?: string;
  session_id?: string;
  project_path?: string;
}

// ============================================================================
// FloatWindow Component
// ============================================================================

const SNAP_THRESHOLD = 240;
const STORAGE_KEY = "lovnotifier-float-window";

interface FloatWindowState {
  x: number;
  y: number;
  isExpanded: boolean;
  snapSide: "left" | "right" | null;
  expandDirection: "left" | "right";
}

function loadState(): Partial<FloatWindowState> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveState(state: Partial<FloatWindowState>) {
  try {
    const current = loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {
    console.error("Failed to save float window state:", e);
  }
}

export function FloatWindow() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [completedItems, setCompletedItems] = useState<ReviewItem[]>([]);
  const [completedHasMore, setCompletedHasMore] = useState(true);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [showOnlyPending, setShowOnlyPending] = useState(true);
  const savedState = loadState();
  const [isExpanded, setIsExpanded] = useState(savedState.isExpanded ?? false);
  const [expandDirection, setExpandDirection] = useState<"left" | "right">(savedState.expandDirection ?? "right");
  const [snapSide, setSnapSide] = useState<"left" | "right" | null>(savedState.snapSide ?? null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const isDraggingRef = useRef(false);
  const initializedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;

  // Cursor polling for non-focused window hover
  useEffect(() => {
    let lastCursor = "default";
    let lastHoveredItem: string | null = null;
    let lastHoverTarget: HTMLElement | null = null;
    let lastHoverGroup: HTMLElement | null = null;
    let intervalId: number | null = null;
    let inFlight = false;
    type CursorInWindow = { supported: boolean; in_window: boolean; x: number; y: number };

    const getBoundsCandidates = async () => {
      const candidates: Array<{ x: number; y: number; width: number; height: number }> = [];
      const domBounds = {
        x: window.screenX,
        y: window.screenY,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      if (
        Number.isFinite(domBounds.x) &&
        Number.isFinite(domBounds.y) &&
        domBounds.width > 0 &&
        domBounds.height > 0
      ) {
        candidates.push(domBounds);
      }

      try {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const windowPos = (await win.innerPosition()).toLogical(scale);
        const windowSize = (await win.innerSize()).toLogical(scale);
        candidates.push({
          x: windowPos.x,
          y: windowPos.y,
          width: windowSize.width,
          height: windowSize.height,
        });
      } catch {
        // ignore
      }

      return candidates;
    };

    const getFallbackRelPos = async () => {
      const [rawCursorX, rawCursorY] = await invoke<[number, number]>("get_cursor_position");
      const scale = window.devicePixelRatio || 1;
      const cursorCandidates = [
        { x: rawCursorX, y: rawCursorY },
        { x: rawCursorX / scale, y: rawCursorY / scale },
      ];
      const boundsCandidates = await getBoundsCandidates();

      let relX = 0;
      let relY = 0;
      let isInWindow = false;
      for (const bounds of boundsCandidates) {
        for (const cursor of cursorCandidates) {
          const rx = cursor.x - bounds.x;
          const ry = cursor.y - bounds.y;
          if (rx >= 0 && rx <= bounds.width && ry >= 0 && ry <= bounds.height) {
            relX = rx;
            relY = ry;
            isInWindow = true;
            break;
          }
        }
        if (isInWindow) break;
      }

      return { relX, relY, isInWindow };
    };

    const checkCursorPosition = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        let relX: number | null = null;
        let relY: number | null = null;
        let isInWindow = false;
        let nativeSupported = false;

        try {
          const nativePos = await invoke<CursorInWindow>("get_cursor_position_in_window", {
            label: "float",
          });
          if (nativePos?.supported) {
            nativeSupported = true;
            if (nativePos.in_window) {
              relX = nativePos.x;
              relY = nativePos.y;
              isInWindow = true;
            }
          }
        } catch {
          // ignore
        }

        if (!nativeSupported) {
          const fallback = await getFallbackRelPos();
          relX = fallback.relX;
          relY = fallback.relY;
          isInWindow = fallback.isInWindow;
        }

        if (isInWindow && relX !== null && relY !== null) {
          const element = document.elementFromPoint(relX, relY) as HTMLElement | null;
          let itemElement = element?.closest('[data-item-id]') as HTMLElement | null;
          let itemId = itemElement?.dataset.itemId ?? null;

          if (!itemId) {
            const itemElements = document.querySelectorAll<HTMLElement>('[data-item-id]');
            for (const candidate of itemElements) {
              const rect = candidate.getBoundingClientRect();
              if (relX >= rect.left && relX <= rect.right && relY >= rect.top && relY <= rect.bottom) {
                itemId = candidate.dataset.itemId ?? null;
                itemElement = candidate;
                break;
              }
            }
          }

          const hoverTarget = element?.closest<HTMLElement>(
            '[data-hover-target], [data-item-id], button, [role="button"], a, .cursor-pointer'
          ) ?? itemElement ?? null;
          const hoverGroup = hoverTarget?.closest<HTMLElement>('.group') ?? null;

          if (hoverTarget !== lastHoverTarget) {
            if (lastHoverTarget) {
              lastHoverTarget.removeAttribute("data-sim-hover");
            }
            if (hoverTarget) {
              hoverTarget.setAttribute("data-sim-hover", "true");
            }
            lastHoverTarget = hoverTarget;
          }
          if (hoverGroup !== lastHoverGroup) {
            if (lastHoverGroup) {
              lastHoverGroup.removeAttribute("data-sim-hover");
            }
            if (hoverGroup) {
              hoverGroup.setAttribute("data-sim-hover", "true");
            }
            lastHoverGroup = hoverGroup;
          }

          if (itemId !== lastHoveredItem) {
            lastHoveredItem = itemId;
            setHoveredId(itemId);
          }

          const isClickable = hoverTarget !== null || itemId !== null;
          const newCursor = isClickable ? "pointer" : "default";

          if (newCursor !== lastCursor) {
            lastCursor = newCursor;
            invoke("set_cursor", { cursorType: newCursor });
          }
        } else {
          if (lastHoverTarget) {
            lastHoverTarget.removeAttribute("data-sim-hover");
            lastHoverTarget = null;
          }
          if (lastHoverGroup) {
            lastHoverGroup.removeAttribute("data-sim-hover");
            lastHoverGroup = null;
          }
          if (lastHoveredItem !== null) {
            lastHoveredItem = null;
            setHoveredId(null);
          }
          if (lastCursor !== "default") {
            lastCursor = "default";
            invoke("set_cursor", { cursorType: "default" });
          }
        }
      } catch {
        // ignore
      } finally {
        inFlight = false;
      }
    };

    intervalId = window.setInterval(checkCursorPosition, 50);
    checkCursorPosition();

    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, []);

  // Snap to edge
  const snapToEdge = async () => {
    const win = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const pos = await win.outerPosition();
    const outerSize = await win.outerSize();
    const innerSize = await win.innerSize();
    const scale = monitor.scaleFactor;

    const monitorX = monitor.position.x / scale;
    const monitorWidth = monitor.size.width / scale;
    const windowX = pos.x / scale;
    const windowY = pos.y / scale;
    const windowWidth = innerSize.width / scale;

    let newX = windowX;
    let snappedSide: "left" | "right" | null = null;

    if (windowX - monitorX < SNAP_THRESHOLD) {
      newX = monitorX;
      snappedSide = "left";
    } else if (monitorX + monitorWidth - windowX - windowWidth < SNAP_THRESHOLD) {
      newX = monitorX + monitorWidth - windowWidth;
      snappedSide = "right";
    }

    setSnapSide(snappedSide);
    saveState({ snapSide: snappedSide });

    if (snappedSide !== null) {
      await win.setPosition(new LogicalPosition(newX, windowY));
      saveState({ x: newX, y: windowY });
    } else {
      saveState({ x: windowX, y: windowY });
    }
  };

  // Mouse up listener for snap
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setTimeout(() => {
          snapToEdge();
        }, 50);
      }
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, []);

  // Load completed items
  const loadCompletedItems = useCallback(async (reset = false) => {
    const offset = reset ? 0 : completedOffset;
    try {
      const items = await invoke<ReviewItem[]>("get_completed_queue", {
        limit: PAGE_SIZE,
        offset,
      });
      if (reset) {
        setCompletedItems(items);
        setCompletedOffset(PAGE_SIZE);
      } else {
        setCompletedItems(prev => [...prev, ...items]);
        setCompletedOffset(offset + PAGE_SIZE);
      }
      setCompletedHasMore(items.length === PAGE_SIZE);
    } catch (e) {
      console.error("Failed to load completed queue:", e);
    }
  }, [completedOffset]);

  // Initial load
  useEffect(() => {
    invoke<ReviewItem[]>("get_review_queue").then(setItems).catch(console.error);
    loadCompletedItems(true);

    const unlisten = listen<ReviewItem[]>("review-queue-update", (event) => {
      setItems(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Load completed when filter changes
  useEffect(() => {
    if (!showOnlyPending) {
      loadCompletedItems(true);
    }
  }, [showOnlyPending]);

  const displayItems = showOnlyPending
    ? items
    : [...items, ...completedItems].sort((a, b) => b.timestamp - a.timestamp);

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56,
    overscan: 5,
  });

  const getCollapsedWidth = () => {
    const paddingX = 12;
    const badgeSize = 24;
    return paddingX * 2 + badgeSize;
  };

  // Initialize window size and position
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initWindow = async () => {
      const win = getCurrentWindow();
      const saved = loadState();

      if (saved.isExpanded) {
        await win.setSize(new LogicalSize(280, 320));
      } else {
        await win.setSize(new LogicalSize(getCollapsedWidth(), 48));
      }

      if (saved.x !== undefined && saved.y !== undefined) {
        await win.setPosition(new LogicalPosition(saved.x, saved.y));
      }
    };
    initWindow();
  }, []);

  const handleItemClick = async (item: ReviewItem) => {
    const hasTmuxContext = item.tmux_session && item.tmux_window && item.tmux_pane;

    if (hasTmuxContext) {
      try {
        await invoke("navigate_to_tmux_pane", {
          session: item.tmux_session,
          window: item.tmux_window,
          pane: item.tmux_pane,
        });
      } catch (e) {
        console.error("navigate_to_tmux_pane failed:", e);
      }
    }

    handleDismiss(item.id);
  };

  const consumeOldestMessage = useCallback(() => {
    if (items.length > 0) {
      const oldest = [...items].sort((a, b) => a.timestamp - b.timestamp)[0];
      handleItemClick(oldest);
    }
  }, [items]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const isRightClick = e.button === 2;
    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;

    const handleMouseMove = async (moveEvent: MouseEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);

      if (!isDragging && (dx > 5 || dy > 5)) {
        isDragging = true;
        isDraggingRef.current = true;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        const win = getCurrentWindow();
        await win.startDragging();
      }
    };

    const handleMouseUp = async () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      if (!isDragging) {
        if (!isExpanded && !isRightClick) {
          if (items.length > 0) {
            consumeOldestMessage();
          } else {
            setShake(true);
            setTimeout(() => setShake(false), 300);
          }
          return;
        }
        const win = getCurrentWindow();
        const pos = await win.outerPosition();

        const expandedWidth = 280;
        const expandedHeight = 320;
        const collapsedHeight = 48;
        const collapsedWidth = getCollapsedWidth();

        const scale = window.devicePixelRatio;
        const windowX = pos.x / scale;
        const windowY = pos.y / scale;

        if (!isExpanded) {
          const screenLeft = (window.screen as { availLeft?: number }).availLeft ?? 0;
          const screenTop = (window.screen as { availTop?: number }).availTop ?? 0;
          const screenWidth = window.screen.availWidth;
          const screenHeight = window.screen.availHeight;

          let newX = windowX;
          let newY = windowY;
          let newExpandDirection: "left" | "right" = "right";

          if (windowX + expandedWidth > screenLeft + screenWidth) {
            newExpandDirection = "left";
            newX = windowX - (expandedWidth - collapsedWidth);
            newX = Math.max(screenLeft, newX);
          }

          if (windowY + expandedHeight > screenTop + screenHeight) {
            newY = screenTop + screenHeight - expandedHeight;
            newY = Math.max(screenTop, newY);
          }

          setExpandDirection(newExpandDirection);
          if (newX !== windowX || newY !== windowY) {
            await win.setPosition(new LogicalPosition(newX, newY));
          }
          await win.setSize(new LogicalSize(expandedWidth, expandedHeight));
          setIsExpanded(true);
          saveState({ isExpanded: true, expandDirection: newExpandDirection, x: newX, y: newY });
        } else {
          setIsExpanded(false);
          let newX = windowX;
          if (expandDirection === "left") {
            newX = windowX + (expandedWidth - collapsedWidth);
            await win.setPosition(new LogicalPosition(newX, windowY));
          }
          await win.setSize(new LogicalSize(collapsedWidth, collapsedHeight));
          saveState({ isExpanded: false, x: newX, y: windowY });
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleDismiss = async (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
    try {
      await invoke("dismiss_review_item", { id });
      loadCompletedItems(true);
    } catch (e) {
      console.error("Failed to dismiss item:", e);
    }
  };

  const handleClearCompleted = async () => {
    try {
      await invoke("clear_completed_queue");
      setCompletedItems([]);
      setCompletedOffset(0);
      setCompletedHasMore(false);
    } catch (e) {
      console.error("Failed to clear completed queue:", e);
    }
  };

  const handleScroll = useCallback(() => {
    if (!listRef.current || showOnlyPending || !completedHasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      loadCompletedItems(false);
    }
  }, [showOnlyPending, completedHasMore, loadCompletedItems]);

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp * 1000;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const collapsedRounding = snapSide === "left"
    ? "rounded-r-full"
    : snapSide === "right"
    ? "rounded-l-full"
    : "rounded-full";

  return (
    <div
      className={`w-screen h-screen bg-amber-700 text-white overflow-hidden flex flex-col ${isExpanded ? "rounded-xl" : collapsedRounding}`}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-2 cursor-pointer select-none shrink-0 ${isExpanded ? "justify-center p-3" : "px-3 py-2 h-full"}`}
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isExpanded ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 flex-1"
          >
            <NotifierLogo className="w-5 h-5 shrink-0" />
            <span className="font-medium text-sm flex-1">Lovnotifier</span>
            <MiniSwitch
              checked={showOnlyPending}
              onChange={setShowOnlyPending}
            />
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                getCurrentWindow().hide();
              }}
              className="p-1 hover:bg-white/20 rounded transition-colors"
            >
              <Cross2Icon className="w-4 h-4" />
            </button>
          </motion.div>
        ) : (
          <motion.span
            className="w-6 h-6 flex items-center justify-center text-xs font-bold bg-white/20 rounded-full"
            animate={shake ? { x: [-2, 2, -2, 2, 0] } : {}}
            transition={{ duration: 0.3 }}
          >
            {items.length}
          </motion.span>
        )}
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="px-3 pb-3 overflow-hidden flex flex-col"
          >
            {/* Status bar */}
            <div className="flex items-center gap-1 mb-2 text-xs opacity-80">
              <span>
                {showOnlyPending
                  ? `${items.length} pending`
                  : `${items.length} pending · ${completedItems.length}${completedHasMore ? "+" : ""} done`}
              </span>
              {!showOnlyPending && completedItems.length > 0 && (
                <button
                  onClick={handleClearCompleted}
                  className="ml-auto p-1 text-white/40 hover:text-white/80 transition-colors"
                  title="Clear completed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Virtualized Items list */}
            <div
              ref={listRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto"
              style={{ maxHeight: 200 }}
            >
              {displayItems.length > 0 ? (
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const item = displayItems[virtualRow.index];
                    const isHovered = hoveredId === item.id;
                    const isCompleted = completedItems.some(c => c.id === item.id);
                    return (
                      <div
                        key={item.id}
                        data-item-id={item.id}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        className="py-1"
                      >
                        <div
                          onClick={() => !isCompleted && handleItemClick(item)}
                          className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                            isCompleted ? "cursor-default" : "cursor-pointer"
                          } ${isHovered ? "bg-white/20" : "bg-white/10"} ${
                            isCompleted ? "opacity-70" : ""
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isCompleted ? "line-through opacity-70" : ""}`}>
                              {item.title}
                              {item.tmux_window && (
                                <span className="text-xs opacity-60 font-normal ml-1">
                                  ({item.tmux_window}, {item.tmux_pane})
                                </span>
                              )}
                            </p>
                            <p className="text-xs opacity-70 truncate">
                              #{item.seq} · {formatTime(item.timestamp)}
                            </p>
                          </div>
                          {!isCompleted && (
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDismiss(item.id);
                              }}
                              className={`p-1 rounded transition-opacity ${
                                isHovered ? "opacity-100 bg-white/10" : "opacity-0"
                              }`}
                            >
                              <Cross2Icon className="w-3.5 h-3.5" />
                            </motion.button>
                          )}
                          {isCompleted && (
                            <CheckIcon className="w-4 h-4 text-white/70" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-sm opacity-70">
                  {showOnlyPending ? "No pending reviews" : "No messages"}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
