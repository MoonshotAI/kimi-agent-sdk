import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { useMemoizedFn } from "ahooks";
import { IconSend, IconPlayerStop, IconChevronDown, IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ActionMenu } from "../ActionMenu";
import { SlashCommandMenu } from "../SlashCommandMenu";
import { FilePickerMenu } from "../FilePickerMenu";
import { MediaThumbnail } from "../MediaThumbnail";
import { MediaPreviewModal } from "../MediaPreviewModal";
import { FileChangesBar } from "../FileChangesBar";
import { ThinkingButton } from "../ThinkingButton";
import { useChatStore, useSettingsStore, getModelById, getModelsForMedia } from "@/stores";
import { bridge, Events } from "@/services";
import { Content } from "@/lib/content";
import { cn } from "@/lib/utils";
import { useSlashMenu, findActiveToken } from "./hooks/useSlashMenu";
import { useFilePicker } from "./hooks/useFilePicker";
import { useMediaUpload } from "./hooks/useMediaUpload";
import { useClickOutside } from "./hooks/useClickOutside";
import { computeMentionInsert } from "./utils";

export function InputArea() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [previewMedia, setPreviewMedia] = useState<string | null>(null);

  const { isStreaming, sendMessage, abort, draftMedia, removeDraftMedia, hasProcessingMedia, getMediaInConversation, pendingInput } = useChatStore();
  const { currentModel, thinkingEnabled, updateModel, toggleThinking, models, extensionConfig, getCurrentThinkingMode } = useSettingsStore();

  const isProcessing = hasProcessingMedia();
  const thinkingMode = getCurrentThinkingMode();

  const mediaReq = useMemo(() => {
    const media = getMediaInConversation();
    return { image: media.hasImage, video: media.hasVideo };
  }, [getMediaInConversation, draftMedia]);

  const availableModels = useMemo(() => getModelsForMedia(models, mediaReq), [models, mediaReq]);
  const currentModelConfig = getModelById(models, currentModel);

  // Auto-switch model if current model doesn't support required media
  useEffect(() => {
    if (!mediaReq.image && !mediaReq.video) {
      return;
    }
    const isCurrentModelValid = availableModels.some((m) => m.id === currentModel);
    if (isCurrentModelValid) {
      return;
    }
    if (availableModels.length > 0) {
      updateModel(availableModels[0].id);
    }
  }, [mediaReq.image, mediaReq.video, currentModel, availableModels, updateModel]);

  // Restore pending input
  useEffect(() => {
    if (!pendingInput || isStreaming) {
      return;
    }

    // 只在输入框为空时恢复
    if (text.trim()) {
      return;
    }

    const textContent = Content.getText(pendingInput.content);
    if (textContent) {
      setText(textContent);
      setTimeout(() => {
        textareaRef.current?.focus();
        adjustHeight();
      }, 0);
    }
  }, [pendingInput, isStreaming]);

  const activeToken = useMemo(() => findActiveToken(text, cursorPos), [text, cursorPos]);

  const { canAddMedia, handlePaste, handlePickMedia } = useMediaUpload();

  const adjustHeight = useMemoizedFn(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }
  });

  const clearInput = useMemoizedFn(() => {
    setText("");
    setCursorPos(0);
    setTimeout(adjustHeight, 0);
  });

  const handleSend = useMemoizedFn(() => {
    if (isStreaming || isProcessing || (!text.trim() && draftMedia.length === 0)) {
      return;
    }

    sendMessage(text);
    clearInput();
  });

  const handleSlashCommand = useMemoizedFn((name: string) => {
    sendMessage(`/${name}`);
    clearInput();
  });

  const applyMention = useMemoizedFn((filePath: string, isAppend: boolean) => {
    const { newText, newCursorPos } = computeMentionInsert({
      text,
      cursorPos,
      filePath,
      activeToken,
      isAppend,
    });

    setText(newText);
    setCursorPos(newCursorPos);

    if (isAppend) {
      setShowAddMenu(false);
    }

    setTimeout(() => {
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      textareaRef.current?.focus();
      adjustHeight();
    }, 0);
  });

  const {
    showSlashMenu,
    filteredCommands,
    selectedIndex: slashSelectedIndex,
    setSelectedIndex: setSlashSelectedIndex,
    handleSlashMenuKey,
    resetSlashMenu,
  } = useSlashMenu(activeToken, handleSlashCommand, clearInput);

  const {
    showFileMenu,
    filePickerMode,
    folderPath,
    fileItems,
    selectedIndex: fileSelectedIndex,
    isLoading: isFileLoading,
    showMediaOption,
    setSelectedIndex: setFileSelectedIndex,
    setFilePickerMode,
    setFolderPath,
    handleFileMenuKey,
    resetFilePicker,
    loadAllFiles,
    setShowAddMenu,
    showAddMenu,
  } = useFilePicker(
    activeToken,
    (filePath, isAddMenu) => applyMention(filePath, isAddMenu),
    () => {
      handlePickMedia();
      setShowAddMenu(false);
    },
    clearInput,
  );

  const closeMenus = useCallback(() => {
    if (showSlashMenu) {
      clearInput();
    }

    if (showFileMenu) {
      if (showAddMenu) {
        setShowAddMenu(false);
      } else {
        clearInput();
      }
    }
  }, [showSlashMenu, showFileMenu, showAddMenu, clearInput, setShowAddMenu]);

  useClickOutside([textareaRef, menuRef], showSlashMenu || showFileMenu, closeMenus);

  useEffect(() => {
    resetSlashMenu();
  }, [showSlashMenu, resetSlashMenu]);

  useEffect(() => {
    if (!showFileMenu) {
      resetFilePicker();
    }
  }, [showFileMenu, resetFilePicker]);

  useEffect(() => {
    const unsub = bridge.on<{ mention: string }>(Events.InsertMention, ({ mention }) => {
      setText((prev) => prev + mention + " ");

      setTimeout(() => {
        textareaRef.current?.focus();
        adjustHeight();
      }, 0);
    });

    return unsub;
  }, [adjustHeight]);

  const handleModelChange = useMemoizedFn((modelId: string) => {
    updateModel(modelId);
  });

  const handleKeyDown = useMemoizedFn((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (handleSlashMenuKey(e)) {
      return;
    }

    if (handleFileMenuKey(e)) {
      return;
    }

    if (extensionConfig.useCtrlEnterToSend) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setCursorPos(e.target.selectionStart);
    setTimeout(adjustHeight, 0);
  };

  const handleSelect = () => {
    setCursorPos(textareaRef.current?.selectionStart ?? 0);
  };

  const handleAddButtonClick = useMemoizedFn(() => {
    setShowAddMenu(true);
    setFileSelectedIndex(0);
    loadAllFiles();
  });

  const hasModels = availableModels.length > 0;
  const canSend = (text.trim() || draftMedia.length > 0) && !isProcessing;

  return (
    <div className="p-2 pt-0!">
      <FileChangesBar />

      <div className="relative">
        {showSlashMenu && filteredCommands.length > 0 && (
          <div ref={menuRef} className="absolute bottom-full left-0 right-0 mb-2 z-10">
            <SlashCommandMenu
              commands={filteredCommands}
              query={activeToken?.query || ""}
              selectedIndex={slashSelectedIndex}
              onSelect={handleSlashCommand}
              onHover={setSlashSelectedIndex}
            />
          </div>
        )}

        {showFileMenu && (
          <div ref={menuRef} className="absolute bottom-full left-0 right-0 mb-2 z-10">
            <FilePickerMenu
              mode={filePickerMode}
              items={fileItems}
              currentPath={folderPath}
              selectedIndex={fileSelectedIndex}
              isLoading={isFileLoading}
              showMediaOption={showMediaOption}
              onSelectMedia={() => {
                handlePickMedia();
                setShowAddMenu(false);
              }}
              onSwitchToFolder={() => {
                setFilePickerMode("folder");
                setFolderPath("");
                setFileSelectedIndex(0);
              }}
              onSwitchToSearch={() => {
                setFilePickerMode("search");
                setFolderPath("");
                setFileSelectedIndex(0);
              }}
              onSelectItem={(item) => applyMention(item.path, showAddMenu)}
              onNavigateUp={() => {
                setFolderPath(folderPath.split("/").slice(0, -1).join("/"));
                setFileSelectedIndex(0);
              }}
              onNavigateInto={(item) => {
                setFilePickerMode("folder");
                setFolderPath(item.path);
                setFileSelectedIndex(0);
              }}
              onHover={setFileSelectedIndex}
            />
          </div>
        )}

        <div className="border border-input rounded-md overflow-hidden">
          {draftMedia.length > 0 && (
            <div className="flex gap-2 p-2 overflow-x-auto">
              {draftMedia.map((item) => (
                <MediaThumbnail
                  key={item.id}
                  src={item.dataUri}
                  size="sm"
                  onClick={item.dataUri ? () => setPreviewMedia(item.dataUri!) : undefined}
                  onRemove={() => removeDraftMedia(item.id)}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onPaste={handlePaste}
            placeholder="Ask Kimi... (/ for commands, @ for files)"
            className={cn(
              "w-full min-h-12 max-h-35 px-2.5 py-1.5 text-xs leading-relaxed",
              "bg-transparent resize-none outline-none border-none overflow-y-auto",
              "placeholder:text-muted-foreground",
            )}
          />

          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="gap-0.5 text-accent-foreground border-0! h-6 px-1.5 min-w-0 max-w-[calc(100%-4rem)]"
                    disabled={isStreaming || !hasModels}
                  >
                    <span className="text-xs truncate block">{currentModelConfig?.name || "No model available"}</span>
                    {hasModels && <IconChevronDown className="size-3.5 shrink-0" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-52!" align="start">
                  {availableModels.map((model) => (
                    <DropdownMenuItem
                      key={model.id}
                      onClick={() => handleModelChange(model.id)}
                      className={cn("text-xs px-3 py-1.5 cursor-pointer", currentModel === model.id && "bg-accent")}
                    >
                      {model.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <ThinkingButton mode={thinkingMode} enabled={thinkingEnabled} disabled={isStreaming} onToggle={toggleThinking} />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={handleAddButtonClick} className="text-muted-foreground">
                    <IconPlus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add files or media</TooltipContent>
              </Tooltip>

              <ActionMenu />

              {isStreaming ? (
                <Button variant="destructive" size="icon-xs" onClick={abort}>
                  <IconPlayerStop className="size-3.5" />
                </Button>
              ) : (
                <Button variant="default" size="icon-xs" onClick={handleSend} disabled={!canSend}>
                  <IconSend className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <MediaPreviewModal src={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
  );
}
