// Bộ định tuyến lệnh giọng nói Việt - Anh & Chấm điểm phát âm thông minh V1.2 Pro
(function () {
  const NUMBER_MAP = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten"
  };

  const CONTRACTION_MAP = {
    "i'm": "i am",
    "you're": "you are",
    "we're": "we are",
    "they're": "they are",
    "it's": "it is",
    "that's": "that is",
    "what's": "what is",
    "let's": "let us",
    "don't": "do not",
    "can't": "cannot",
    "i've": "i have"
  };

  function normalizeText(str) {
    if (!str) return "";
    let s = str.toLowerCase().trim();
    Object.keys(CONTRACTION_MAP).forEach((k) => {
      s = s.replace(new RegExp("\\b" + k + "\\b", "g"), CONTRACTION_MAP[k]);
    });
    s = s.replace(/[^a-z0-9\s\u00C0-\u1EF9]/g, " ");
    const tokens = s.split(/\s+/).filter(Boolean).map((t) => NUMBER_MAP[t] || t);
    return tokens.join(" ");
  }

  // Khoảng cách Levenshtein để chấm tương đồng âm tiết giữa từ nhận diện và từ chuẩn
  function similarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return 1 - dp[m][n] / Math.max(m, n);
  }

  // Bảng nhận diện lệnh chuyển tính năng (bao gồm cả phiên âm tiếng Việt khi Mic chạy en-US)
  const COMMAND_PATTERNS = [
    {
      cmd: "MODE_YOUTUBE",
      phrases: [
        "youtube", "you tube", "open youtube", "watch youtube", "play youtube",
        "xem youtube", "mo youtube", "same youtube", "sam youtube", "send youtube",
        "see youtube", "seem youtube", "zen youtube", "video"
      ]
    },
    {
      cmd: "MODE_GAME",
      phrases: [
        "play game", "play games", "open game", "start game", "game time",
        "choi game", "mo game", "joy game", "toy game", "choi gam", "chơi game", "mở game"
      ]
    },
    {
      cmd: "MODE_ROBOT",
      phrases: [
        "learn english", "study english", "english lesson", "open robot", "back to robot",
        "hey robot", "hey robo", "hello robo", "wake up",
        "hoc tieng anh", "tieng anh", "ve robot", "quay lai", "robot oi",
        "hop ting", "hot thing", "hug thing", "why lie", "way robot"
      ]
    },
    {
      cmd: "ACTION_TRANSLATE",
      phrases: [
        "translate", "vietnamese", "what does it mean", "meaning",
        "dich nghia", "nghia la gi", "dich tieng viet", "khong hieu"
      ]
    },
    {
      cmd: "ACTION_REPEAT",
      phrases: [
        "repeat", "say again", "listen again", "read again",
        "doc lai", "nghe lai", "noi lai"
      ]
    },
    {
      cmd: "ACTION_NEXT",
      phrases: [
        "next sentence", "next question", "skip", "pass",
        "cau tiep theo", "bo qua", "qua cau"
      ]
    },
    {
      cmd: "ACTION_SLEEP",
      phrases: [
        "go to sleep", "sleep mode", "good night",
        "ngu di", "di ngu", "tat man hinh"
      ]
    }
  ];

  function detectVoiceCommand(candidates) {
    const list = Array.isArray(candidates) ? candidates : [candidates];
    for (const raw of list) {
      const norm = normalizeText(raw);
      if (!norm) continue;
      for (const group of COMMAND_PATTERNS) {
        for (const p of group.phrases) {
          if (norm === p || norm.includes(p)) {
            return group.cmd;
          }
        }
      }
    }
    return null;
  }

  // Chấm điểm từng từ (Word-level Pronunciation Scorer)
  function gradePronunciation(targetSentence, candidates) {
    const targetTokens = normalizeText(targetSentence).split(" ").filter(Boolean);
    const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);

    let bestResult = {
      score: 0,
      passed: false,
      bestHeard: list[0] || "",
      wordMatches: targetTokens.map(() => false)
    };

    for (const cand of list) {
      const spokenTokens = normalizeText(cand).split(" ").filter(Boolean);
      const matches = targetTokens.map((tWord) => {
        return spokenTokens.some((sWord) => similarity(tWord, sWord) >= 0.76);
      });
      const matchedCount = matches.filter(Boolean).length;
      const pct = targetTokens.length ? Math.round((matchedCount / targetTokens.length) * 100) : 0;

      if (pct >= bestResult.score) {
        bestResult = {
          score: pct,
          passed: pct >= 75,
          bestHeard: cand,
          wordMatches: matches
        };
      }
    }
    return bestResult;
  }

  window.VoiceRouter = {
    normalizeText,
    detectVoiceCommand,
    gradePronunciation
  };
})();
