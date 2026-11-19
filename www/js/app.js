// Robot 2027 V1.2 Pro - Core Interactive Controller
(function () {
  const SpeechBridge = window.Capacitor?.Plugins?.SpeechBridge || null;

  const SERVER_URLS = {
    youtube: "https://trithuc.io.vn/robot2027/youtube.php",
    game: "https://trithuc.io.vn/robot2027/game.php"
  };

  // Trạng thái hệ thống
  const state = {
    mode: "robot",          // 'robot' | 'youtube' | 'game'
    splitMode: false,       // true = mắt trượt sang trái, mở bảng học
    botPhase: "IDLE",       // 'IDLE' | 'SPEAKING' | 'COOLDOWN' | 'LISTENING' | 'GRADING' | 'SLEEP'
    autoLoop: true,         // Tự động bật mic sau khi robot đọc mẫu xong
    topicKey: localStorage.getItem("r27_topic") || "greetings",
    levelFilter: parseInt(localStorage.getItem("r27_level") || "0", 10), // 0 = tất cả
    sentenceIndex: parseInt(localStorage.getItem("r27_idx") || "0", 10),
    stars: parseInt(localStorage.getItem("r27_stars") || "0", 10),
    streak: parseInt(localStorage.getItem("r27_streak") || "1", 10),
    activeUser: localStorage.getItem("r27_user") || "Bé Bi",
    mistakes: JSON.parse(localStorage.getItem("r27_mistakes") || "[]"),
    rewardLockEnabled: localStorage.getItem("r27_reward_lock") === "1",
    rewardSecondsLeft: parseInt(localStorage.getItem("r27_reward_sec") || "0", 10),
    adminPin: localStorage.getItem("r27_pin") || "2027",
    lastHeardText: "",
    lastCmdTime: 0,
    sleepTimer: null,
    hamburgerDimTimer: null,
    pendingTtsAction: null
  };

  const SLEEP_TIMEOUT_MS = 75000; // 75s không tương tác -> ngủ bảo vệ OLED

  // =========================================================
  // 1. ĐIỀU HƯỚNG HAMBURGER GÓC TRÊN BÊN PHẢI (THU GỌN & XỔ FULL)
  // =========================================================
  window.toggleHamburger = function (forceState) {
    const wrap = document.getElementById("hamburger-wrap");
    const backdrop = document.getElementById("nav-backdrop");
    const trigger = document.getElementById("hamburger-trigger");

    const nextOpen = typeof forceState === "boolean"
      ? forceState
      : !wrap.classList.contains("expanded");

    wrap.classList.toggle("expanded", nextOpen);
    backdrop.classList.toggle("open", nextOpen);
    trigger.classList.remove("dimmed");

    clearTimeout(state.hamburgerDimTimer);
    if (!nextOpen && state.mode !== "robot") {
      state.hamburgerDimTimer = setTimeout(() => {
        trigger.classList.add("dimmed");
      }, 3500);
    }
  };

  function updateHamburgerBadge() {
    const iconMap = { robot: "🤖", youtube: "▶️", game: "🎮" };
    document.getElementById("hamburger-current-icon").textContent = iconMap[state.mode] || "🤖";

    document.querySelectorAll(".drawer-icon-btn[data-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === state.mode);
    });
  }

  // =========================================================
  // 2. CHUYỂN CHẾ ĐỘ (ROBOT / YOUTUBE / GAME) & CHỐNG MẤT MIC
  // =========================================================
  window.switchMode = async function (targetMode) {
    toggleHamburger(false);

    // Kiểm tra chế độ Tích Sao Mở Khóa (nếu phụ huynh bật)
    if ((targetMode === "youtube" || targetMode === "game") && state.rewardLockEnabled) {
      if (state.rewardSecondsLeft <= 0) {
        if (state.stars >= 5) {
          state.stars -= 5;
          state.rewardSecondsLeft = 600; // Đổi 5 sao = 10 phút giải trí
          saveProgress();
          updateStatsUI();
        } else {
          showToast(`Cần 5 ⭐ để mở khóa 10 phút ${targetMode === "youtube" ? "YouTube" : "Game"} (Hiện có ${state.stars} ⭐)`);
          speakVietnamese(`Bạn cần tích đủ 5 ngôi sao tiếng Anh để mở khóa 10 phút giải trí nhé!`);
          return;
        }
      }
    }

    state.mode = targetMode;
    updateHamburgerBadge();

    document.querySelectorAll(".screen-view").forEach((v) => v.classList.remove("active"));
    document.getElementById("view-" + targetMode).classList.add("active");

    const voiceBackBtn = document.getElementById("floating-voice-back");

    if (targetMode === "robot") {
      voiceBackBtn.classList.remove("show");
      pauseEmbeddedIframes();
      wakeRobot(true);

      // Khởi tạo mới hoàn toàn bộ thu âm để không bao giờ bị mất Mic khi từ YouTube/Game quay về
      if (SpeechBridge) {
        try {
          await SpeechBridge.resetMic({ resume: state.autoLoop, continuous: state.autoLoop });
        } catch (e) {}
      }
      setBotStatus("🤖 Đã quay lại Robot! Sẵn sàng nghe bạn nói.");
    } else {
      // Sang YouTube hoặc Game: dừng giọng đọc robot, hủy hẹn giờ ngủ, nạp iframe
      stopAllSpeech();
      clearTimeout(state.sleepTimer);
      document.getElementById("sleep-overlay").classList.remove("active");
      voiceBackBtn.classList.add("show");

      // Giữ lắng nghe lệnh quay lại ("Học tiếng Anh") ở chế độ nền nhẹ
      if (SpeechBridge) {
        try {
          await SpeechBridge.resetMic({ resume: true, continuous: true });
        } catch (e) {}
      }

      loadIframeWithGuard(targetMode);
    }
  };

  function pauseEmbeddedIframes() {
    ["youtube", "game"].forEach((key) => {
      const iframe = document.getElementById("iframe-" + key);
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: "ROBOT_PAUSE", action: "pause" }, "*");
        } catch (e) {}
      }
    });
  }

  function loadIframeWithGuard(key) {
    const iframe = document.getElementById("iframe-" + key);
    const loadingBox = document.getElementById("loading-" + key);
    const offlineBox = document.getElementById("offline-" + key);

    if (!navigator.onLine) {
      loadingBox.classList.remove("show");
      offlineBox.classList.add("show");
      return;
    }

    offlineBox.classList.remove("show");
    if (!iframe.getAttribute("src")) {
      loadingBox.classList.add("show");
      iframe.onload = () => loadingBox.classList.remove("show");
      iframe.onerror = () => {
        loadingBox.classList.remove("show");
        offlineBox.classList.add("show");
      };
      iframe.src = SERVER_URLS[key];
      setTimeout(() => loadingBox.classList.remove("show"), 6000);
    }
  }

  window.reloadIframe = function (key) {
    const iframe = document.getElementById("iframe-" + key);
    iframe.removeAttribute("src");
    loadIframeWithGuard(key);
  };

  // =========================================================
  // 3. QUẢN LÝ BÀI HỌC TIẾNG ANH & KARAOKE TỪNG TỪ
  // =========================================================
  function getFilteredSentences() {
    if (state.topicKey === "mistakes") {
      return state.mistakes.length > 0
        ? state.mistakes
        : [{ level: 1, en: "Great job! You have no mistakes yet.", vi: "Tuyệt vời! Bạn chưa có câu sai nào cần ôn lại.", explain: "Hãy luyện thêm các chủ đề khác nhé!" }];
    }
    const topic = window.ROBOT_LESSONS[state.topicKey] || window.ROBOT_LESSONS.greetings;
    const filtered = state.levelFilter > 0
      ? topic.items.filter((x) => x.level === state.levelFilter)
      : topic.items;
    return filtered.length > 0 ? filtered : topic.items;
  }

  function getCurrentItem() {
    const list = getFilteredSentences();
    if (state.sentenceIndex >= list.length) state.sentenceIndex = 0;
    return list[state.sentenceIndex];
  }

  window.openLessonPanel = function (open) {
    resetSleepTimer();
    const view = document.getElementById("view-robot");
    state.splitMode = open;
    view.classList.toggle("split-mode", open);

    if (open) {
      renderCurrentSentence();
      speakCurrentSample();
    } else {
      stopAllSpeech();
      setEyeMood("IDLE");
    }
  };

  function renderCurrentSentence() {
    const list = getFilteredSentences();
    const item = getCurrentItem();

    document.getElementById("sentence-counter").textContent =
      `Câu ${state.sentenceIndex + 1}/${list.length}`;

    const words = item.en.split(" ");
    const container = document.getElementById("en-sentence");
    container.innerHTML = words
      .map((w, idx) => {
        const cleanWord = w.replace(/'/g, "\'");
        return `<span class="en-word" id="word-${idx}" onclick="speakSingleWord('${cleanWord}', ${idx})">${w}</span>`;
      })
      .join(" ");

    document.getElementById("vi-meaning").textContent = item.vi;
    document.getElementById("vi-explain").textContent = item.explain;
    document.getElementById("vi-box").classList.remove("show");
    document.getElementById("heard-box").classList.remove("show");
  }

  // Chạm trực tiếp vào 1 từ bất kỳ để nghe robot đọc chậm từ đó
  window.speakSingleWord = function (word, idx) {
    resetSleepTimer();
    document.querySelectorAll(".en-word").forEach((el) => el.classList.remove("karaoke-active"));
    const el = document.getElementById("word-" + idx);
    if (el) el.classList.add("karaoke-active");

    stopAllSpeech();
    setBotStatus(`🔊 Đang đọc chậm từ: "${word}"`);
    speakEnglish(word, 0.72, () => {
      if (el) el.classList.remove("karaoke-active");
    });
  };

  window.speakCurrentSample = function () {
    resetSleepTimer();
    const item = getCurrentItem();
    const words = item.en.split(" ");

    stopAllSpeech();
    state.botPhase = "SPEAKING";
    setEyeMood("SPEAKING");
    setBotStatus("🔊 Robo đang đọc mẫu... (Chạm màn hình để ngắt lời)");

    // Hiệu ứng chạy chữ Karaoke đồng bộ
    let wIdx = 0;
    clearInterval(window._karaokeTimer);
    window._karaokeTimer = setInterval(() => {
      document.querySelectorAll(".en-word").forEach((el) => el.classList.remove("karaoke-active"));
      if (wIdx < words.length) {
        document.getElementById("word-" + wIdx)?.classList.add("karaoke-active");
        wIdx++;
      } else {
        clearInterval(window._karaokeTimer);
      }
    }, 340);

    speakEnglish(item.en, 0.9, () => {
      clearInterval(window._karaokeTimer);
      document.querySelectorAll(".en-word").forEach((el) => el.classList.remove("karaoke-active"));
      setEyeMood("IDLE");

      // Cooldown 350ms chống vang âm (Echo Loop) rồi tự bật Mic cho bé đọc
      state.botPhase = "COOLDOWN";
      if (state.autoLoop && state.mode === "robot") {
        setBotStatus("🎙️ Đến lượt bạn đọc lại nhé!");
        setTimeout(() => {
          if (state.mode === "robot" && state.botPhase === "COOLDOWN") {
            startUserMic(false);
          }
        }, 350);
      } else {
        state.botPhase = "IDLE";
        setBotStatus("Bấm 🎙️ Đọc lại để luyện phát âm nhé!");
      }
    });
  };

  window.toggleTranslation = function () {
    resetSleepTimer();
    const box = document.getElementById("vi-box");
    const willShow = !box.classList.contains("show");
    box.classList.toggle("show", willShow);

    if (willShow) {
      const item = getCurrentItem();
      speakVietnamese(`${item.vi}. ${item.explain}`);
    }
  };

  window.nextSentence = function () {
    resetSleepTimer();
    const list = getFilteredSentences();
    state.sentenceIndex = (state.sentenceIndex + 1) % list.length;
    saveProgress();
    renderCurrentSentence();
    speakCurrentSample();
  };

  window.replayLastHeard = function () {
    if (!state.lastHeardText) return;
    resetSleepTimer();
    speakEnglish(state.lastHeardText, 0.9);
  };

  // =========================================================
  // 4. HỆ THỐNG ÂM THANH KÉP (0ms LAG) & NHẬN DIỆN GIỌNG NÓI
  // =========================================================
  function speakEnglish(text, rate, onDone) {
    state.pendingTtsAction = onDone || null;
    if (SpeechBridge) {
      SpeechBridge.speakEn({ text, rate: rate || 0.92 }).catch(() => {
        if (onDone) onDone();
      });
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = rate || 0.92;
      u.onend = () => { if (onDone) onDone(); };
      u.onerror = () => { if (onDone) onDone(); };
      window.speechSynthesis.speak(u);
    } else {
      setTimeout(() => { if (onDone) onDone(); }, 1200);
    }
  }

  function speakVietnamese(text, onDone) {
    state.pendingTtsAction = onDone || null;
    if (SpeechBridge) {
      SpeechBridge.speakVi({ text, rate: 1.0 }).catch(() => {
        if (onDone) onDone();
      });
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "vi-VN";
      u.onend = () => { if (onDone) onDone(); };
      window.speechSynthesis.speak(u);
    } else {
      setTimeout(() => { if (onDone) onDone(); }, 1200);
    }
  }

  function stopAllSpeech() {
    clearInterval(window._karaokeTimer);
    state.pendingTtsAction = null;
    if (SpeechBridge) {
      SpeechBridge.stopSpeaking().catch(() => {});
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  // Ngắt lời tức thì (Barge-in) khi chạm vào mặt Robot
  window.handleStageTap = function () {
    if (state.botPhase === "SLEEP") {
      wakeRobot(true);
      return;
    }
    resetSleepTimer();
    if (state.botPhase === "SPEAKING") {
      stopAllSpeech();
      startUserMic(false);
    }
  };

  window.startUserMic = async function (continuous) {
    resetSleepTimer();
    stopAllSpeech();
    state.botPhase = "LISTENING";
    setEyeMood("LISTENING");
    document.getElementById("btn-speak")?.classList.add("active-mic");
    document.getElementById("mic-wave-bar")?.classList.add("active");
    setBotStatus("🎙️ Đang nghe bạn nói...");

    if (SpeechBridge) {
      try {
        await SpeechBridge.startListening({ continuous: !!continuous });
      } catch (e) {
        setBotStatus("⚠️ Không mở được Micro. Kiểm tra quyền ghi âm!");
      }
    } else if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        if (e.results[0].isFinal) {
          handleSpeechFinal([transcript]);
        } else {
          handleSpeechPartial(transcript);
        }
      };
      rec.onerror = () => {
        state.botPhase = "IDLE";
        setEyeMood("IDLE");
        document.getElementById("btn-speak")?.classList.remove("active-mic");
      };
      rec.start();
    }
  };

  window.toggleAutoLoop = function () {
    state.autoLoop = !state.autoLoop;
    const btn = document.getElementById("btn-auto-loop");
    btn.classList.toggle("auto-on", state.autoLoop);
    btn.textContent = state.autoLoop ? "🔄 Rảnh tay: BẬT" : "⏸ Rảnh tay: TẮT";
    showToast(state.autoLoop ? "Đã bật hội thoại rảnh tay liên tục" : "Đã tắt tự động bật Mic");
  };

  function handleSpeechPartial(text) {
    if (!text) return;
    resetSleepTimer();

    // Đánh thức ngay nếu đang ngủ mà nghe gọi
    if (state.botPhase === "SLEEP") {
      const cmdWake = window.VoiceRouter.detectVoiceCommand([text]);
      if (cmdWake === "MODE_ROBOT") {
        wakeRobot(true);
      }
      return;
    }

    const cap = document.getElementById("live-caption");
    if (cap && state.mode === "robot") {
      cap.textContent = `💬 "${text}"`;
      cap.classList.add("show");
    }

    // Bắt lệnh chuyển tab ngay khi đang nói dở (không cần đợi ngắt câu)
    const now = Date.now();
    if (now - state.lastCmdTime > 1400) {
      const cmd = window.VoiceRouter.detectVoiceCommand([text]);
      if (cmd && (cmd === "MODE_YOUTUBE" || cmd === "MODE_GAME" || cmd === "MODE_ROBOT")) {
        state.lastCmdTime = now;
        executeVoiceCommand(cmd);
      }
    }
  }

  function handleSpeechFinal(alternatives) {
    document.getElementById("btn-speak")?.classList.remove("active-mic");
    document.getElementById("mic-wave-bar")?.classList.remove("active");
    const cap = document.getElementById("live-caption");
    if (cap) cap.classList.remove("show");

    if (!alternatives || alternatives.length === 0) return;

    // 1. Kiểm tra xem có phải lệnh điều khiển tính năng không
    const now = Date.now();
    const cmd = window.VoiceRouter.detectVoiceCommand(alternatives);
    if (cmd) {
      if (now - state.lastCmdTime > 1200) {
        state.lastCmdTime = now;
        executeVoiceCommand(cmd);
      }
      return;
    }

    // Nếu đang ở tab YouTube hoặc Game thì bỏ qua hội thoại thường
    if (state.mode !== "robot") return;

    // 2. Nếu chưa mở bảng học, tự động mở bảng học hoặc chào đáp lại
    if (!state.splitMode) {
      openLessonPanel(true);
      return;
    }

    // 3. Chấm điểm phát âm từng từ
    state.botPhase = "GRADING";
    const item = getCurrentItem();
    const result = window.VoiceRouter.gradePronunciation(item.en, alternatives);
    state.lastHeardText = result.bestHeard;

    // Hiển thị câu bé vừa nói kèm nút nghe lại chính giọng nhận diện
    const heardBox = document.getElementById("heard-box");
    document.getElementById("heard-text").textContent = `Bạn nói: "${result.bestHeard}" (${result.score}%)`;
    heardBox.classList.add("show");

    // Tô màu từng từ đúng (xanh) / sai (đỏ)
    result.wordMatches.forEach((ok, idx) => {
      const wEl = document.getElementById("word-" + idx);
      if (wEl) {
        wEl.classList.remove("word-correct", "word-wrong");
        wEl.classList.add(ok ? "word-correct" : "word-wrong");
      }
    });

    if (result.passed) {
      setEyeMood("HAPPY");
      state.stars += 1;
      removeMistake(item);
      saveProgress();
      updateStatsUI();
      sendBleSignal("M:HAPPY");

      setBotStatus(`🌟 Tuyệt vời! Đạt ${result.score}% (+1 ⭐)`);
      document.getElementById("vi-box").classList.add("show");

      speakEnglish("Awesome! Great job!", 1.0, () => {
        speakVietnamese(item.vi, () => {
          setTimeout(() => {
            if (state.mode === "robot" && state.splitMode) {
              nextSentence();
            }
          }, 900);
        });
      });
    } else {
      setEyeMood("RETRY");
      addMistake(item);
      saveProgress();
      setBotStatus(`💡 Gần đúng (${result.score}%)! Chạm từ màu đỏ để nghe chậm rồi đọc lại nhé.`);

      speakEnglish("Almost there! Try again.", 0.95, () => {
        if (state.autoLoop && state.mode === "robot") {
          setTimeout(() => startUserMic(false), 350);
        } else {
          state.botPhase = "IDLE";
        }
      });
    }
  }

  function executeVoiceCommand(cmd) {
    if (cmd === "MODE_YOUTUBE") {
      switchMode("youtube");
    } else if (cmd === "MODE_GAME") {
      switchMode("game");
    } else if (cmd === "MODE_ROBOT") {
      if (state.mode !== "robot") switchMode("robot");
      else if (!state.splitMode) openLessonPanel(true);
    } else if (cmd === "ACTION_TRANSLATE") {
      if (!state.splitMode) openLessonPanel(true);
      toggleTranslation();
    } else if (cmd === "ACTION_REPEAT") {
      if (!state.splitMode) openLessonPanel(true);
      speakCurrentSample();
    } else if (cmd === "ACTION_NEXT") {
      if (!state.splitMode) openLessonPanel(true);
      nextSentence();
    } else if (cmd === "ACTION_SLEEP") {
      enterSleepMode();
    }
  }

  // =========================================================
  // 5. BIỂU CẢM MẮT, CHỐNG LƯU ẢNH OLED & CHẾ ĐỘ NGỦ
  // =========================================================
  function setEyeMood(mood) {
    const eL = document.getElementById("eye-left");
    const eR = document.getElementById("eye-right");
    const mouth = document.getElementById("robot-mouth");

    eL.className = "robot-eye";
    eR.className = "robot-eye";
    mouth.className = "robot-mouth";

    if (mood === "HAPPY") {
      eL.classList.add("happy");
      eR.classList.add("happy");
      mouth.classList.add("happy");
    } else if (mood === "LISTENING") {
      eL.classList.add("listening");
      eR.classList.add("listening");
    } else if (mood === "SPEAKING") {
      mouth.classList.add("speaking");
    } else if (mood === "THINKING") {
      eL.classList.add("thinking");
      eR.classList.add("thinking");
    } else if (mood === "RETRY") {
      eL.classList.add("retry");
      eR.classList.add("retry");
    }
  }

  function setBotStatus(msg) {
    const el = document.getElementById("robot-status");
    if (el) el.textContent = msg;
  }

  // Chớp mắt tự nhiên & dịch chuyển nhẹ tọa độ OLED chống burn-in
  setInterval(() => {
    if (state.mode !== "robot" || state.botPhase === "SLEEP") return;
    const eL = document.getElementById("eye-left");
    const eR = document.getElementById("eye-right");
    if (!eL.classList.contains("happy")) {
      eL.classList.add("blink");
      eR.classList.add("blink");
      setTimeout(() => {
        eL.classList.remove("blink");
        eR.classList.remove("blink");
      }, 150);
    }
  }, 4100);

  setInterval(() => {
    const layer = document.getElementById("oled-drift-layer");
    if (!layer) return;
    const dx = Math.floor(Math.random() * 9) - 4; // -4px .. +4px
    const dy = Math.floor(Math.random() * 7) - 3; // -3px .. +3px
    layer.style.transform = `translate(${dx}px, ${dy}px)`;
  }, 15000);

  function resetSleepTimer() {
    clearTimeout(state.sleepTimer);
    if (state.mode === "robot") {
      state.sleepTimer = setTimeout(enterSleepMode, SLEEP_TIMEOUT_MS);
    }
  }

  function enterSleepMode() {
    if (state.mode !== "robot") return;
    stopAllSpeech();
    state.botPhase = "SLEEP";
    document.getElementById("sleep-overlay").classList.add("active");
    if (SpeechBridge) {
      SpeechBridge.setScreenBrightness({ level: 0.06 }).catch(() => {});
    }
  }

  window.wakeRobot = function (greet) {
    const wasSleeping = state.botPhase === "SLEEP";
    document.getElementById("sleep-overlay").classList.remove("active");
    if (wasSleeping) {
      state.botPhase = "IDLE";
      setEyeMood("HAPPY");
      if (SpeechBridge) {
        SpeechBridge.setScreenBrightness({ level: -1.0 }).catch(() => {});
      }
      setBotStatus(`👋 Chào ${state.activeUser}! Robo thức dậy rồi đây!`);
      if (greet) {
        speakEnglish(`Hello ${state.activeUser}! I am awake!`, 1.0, () => setEyeMood("IDLE"));
      }
    }
    resetSleepTimer();
  };

  // =========================================================
  // 6. HỒ SƠ NGƯỜI HỌC, ÔN TẬP CÂU SAI, HẸN GIỜ THƯỞNG & PIN KIOSK
  // =========================================================
  function addMistake(item) {
    if (!state.mistakes.some((m) => m.en === item.en)) {
      state.mistakes.push(item);
      if (state.mistakes.length > 25) state.mistakes.shift();
    }
  }

  function removeMistake(item) {
    state.mistakes = state.mistakes.filter((m) => m.en !== item.en);
  }

  function saveProgress() {
    localStorage.setItem("r27_topic", state.topicKey);
    localStorage.setItem("r27_level", String(state.levelFilter));
    localStorage.setItem("r27_idx", String(state.sentenceIndex));
    localStorage.setItem("r27_stars", String(state.stars));
    localStorage.setItem("r27_user", state.activeUser);
    localStorage.setItem("r27_mistakes", JSON.stringify(state.mistakes));
    localStorage.setItem("r27_reward_lock", state.rewardLockEnabled ? "1" : "0");
    localStorage.setItem("r27_reward_sec", String(state.rewardSecondsLeft));
  }

  function updateStatsUI() {
    document.getElementById("user-stars").textContent = state.stars;
    document.getElementById("active-user-badge").textContent = `👤 ${state.activeUser}`;
  }

  window.onTopicOrLevelChange = function () {
    state.topicKey = document.getElementById("topic-select").value;
    state.levelFilter = parseInt(document.getElementById("level-select").value, 10);
    state.sentenceIndex = 0;
    saveProgress();
    renderCurrentSentence();
    speakCurrentSample();
  };

  window.openSettingsModal = function () {
    toggleHamburger(false);
    document.getElementById("setting-user-name").value = state.activeUser;
    document.getElementById("setting-reward-lock").checked = state.rewardLockEnabled;
    document.getElementById("settings-modal").classList.add("open");
  };

  window.closeSettingsModal = function () {
    document.getElementById("settings-modal").classList.remove("open");
  };

  window.saveSettingsModal = function () {
    const newName = document.getElementById("setting-user-name").value.trim();
    if (newName) state.activeUser = newName;
    state.rewardLockEnabled = document.getElementById("setting-reward-lock").checked;
    saveProgress();
    updateStatsUI();
    closeSettingsModal();
    showToast("Đã lưu cài đặt học tập!");
  };

  // Đếm ngược thời gian giải trí nếu bật chế độ Tích Sao Mở Khóa
  setInterval(() => {
    const badge = document.getElementById("reward-timer-pill");
    if (state.rewardLockEnabled && state.rewardSecondsLeft > 0 && (state.mode === "youtube" || state.mode === "game")) {
      state.rewardSecondsLeft -= 1;
      const m = Math.floor(state.rewardSecondsLeft / 60);
      const s = String(state.rewardSecondsLeft % 60).padStart(2, "0");
      badge.textContent = `⏳ ${m}:${s}`;
      badge.classList.add("active");
      if (state.rewardSecondsLeft <= 0) {
        saveProgress();
        badge.classList.remove("active");
        switchMode("robot");
        speakVietnamese("Hết giờ giải trí rồi! Mình cùng quay lại học tiếng Anh tích thêm sao nhé!");
      }
    } else {
      badge.classList.remove("active");
    }
  }, 1000);

  // Cổng thoát Kiosk bí mật (Chạm 5 lần vào góc trên bên trái -> nhập PIN 2027)
  let secretTapCount = 0;
  let secretTapResetTimer = null;
  window.handleSecretCornerTap = function () {
    secretTapCount++;
    clearTimeout(secretTapResetTimer);
    secretTapResetTimer = setTimeout(() => { secretTapCount = 0; }, 2200);
    if (secretTapCount >= 5) {
      secretTapCount = 0;
      document.getElementById("pin-input").value = "";
      document.getElementById("pin-modal").classList.add("open");
    }
  };

  window.verifyAdminPin = async function () {
    const entered = document.getElementById("pin-input").value.trim();
    if (entered === state.adminPin) {
      document.getElementById("pin-modal").classList.remove("open");
      if (SpeechBridge) {
        await SpeechBridge.setKioskPinLock({ locked: false });
      }
      showToast("🔓 Đã mở khóa Kiosk! Bạn có thể vuốt thoát ứng dụng.");
    } else {
      showToast("❌ Sai mã PIN quản trị!");
    }
  };

  window.relockKiosk = async function () {
    document.getElementById("pin-modal").classList.remove("open");
    if (SpeechBridge) {
      await SpeechBridge.setKioskPinLock({ locked: true });
    }
    showToast("🔒 Đã khóa chặt chế độ Kiosk!");
  };

  // Cổng chờ BLE phần cứng ESP32
  function sendBleSignal(cmd) {
    if (window.RobotBLE && typeof window.RobotBLE.send === "function") {
      window.RobotBLE.send(cmd);
    }
  }

  function showToast(text) {
    setBotStatus(text);
  }

  // =========================================================
  // 7. LẮNG NGHE SỰ KIỆN TỪ NATIVE ANDROID SPEECHBRIDGE
  // =========================================================
  function bindNativeSpeechEvents() {
    if (!SpeechBridge) return;

    SpeechBridge.addListener("ttsDone", () => {
      const cb = state.pendingTtsAction;
      state.pendingTtsAction = null;
      if (typeof cb === "function") cb();
    });

    SpeechBridge.addListener("speechPartial", (data) => {
      handleSpeechPartial(data?.text || "");
    });

    SpeechBridge.addListener("speechResult", (data) => {
      handleSpeechFinal(data?.alternatives || [data?.text]);
    });

    SpeechBridge.addListener("speechRms", (data) => {
      const rms = Number(data?.rms || 0);
      // Vỗ tay / tiếng gọi lớn khi đang ngủ -> đánh thức Robot
      if (state.botPhase === "SLEEP" && rms > 8.5) {
        wakeRobot(true);
        return;
      }
      const fill = document.getElementById("mic-wave-fill");
      if (fill) {
        const pct = Math.min(100, Math.max(10, Math.round((rms + 2) * 8)));
        fill.style.width = pct + "%";
      }
    });

    SpeechBridge.addListener("speechState", (data) => {
      if (data?.state === "stopped" && state.botPhase === "LISTENING") {
        state.botPhase = "IDLE";
        setEyeMood("IDLE");
        document.getElementById("btn-speak")?.classList.remove("active-mic");
        document.getElementById("mic-wave-bar")?.classList.remove("active");
      }
    });
  }

  // Khởi động giao diện
  window.addEventListener("DOMContentLoaded", () => {
    const topicSel = document.getElementById("topic-select");
    Object.keys(window.ROBOT_LESSONS).forEach((k) => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = window.ROBOT_LESSONS[k].title;
      topicSel.appendChild(opt);
    });
    const mistakeOpt = document.createElement("option");
    mistakeOpt.value = "mistakes";
    mistakeOpt.textContent = "🔁 Ôn tập câu hay sai";
    topicSel.appendChild(mistakeOpt);

    topicSel.value = state.topicKey;
    document.getElementById("level-select").value = String(state.levelFilter);

    updateStatsUI();
    updateHamburgerBadge();
    bindNativeSpeechEvents();
    resetSleepTimer();

    // Lời chào mở màn nhẹ nhàng
    setTimeout(() => {
      setBotStatus(`👋 Chào ${state.activeUser}! Bấm Bắt đầu học hoặc gọi "Học tiếng Anh" nhé!`);
    }, 500);
  });
})();
