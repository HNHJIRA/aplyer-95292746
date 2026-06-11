// Structured developer logger for Aplyer content scripts.
(function () {
  const TAG = "%c[Aplyer]";
  const STYLE = "background:#1DB954;color:#06140A;padding:1px 6px;border-radius:3px;font-weight:700";
  const ts = () => new Date().toISOString().split("T")[1].replace("Z", "");
  function emit(level, scope, msg, data) {
    const args = [`${TAG} %c${ts()} %c${scope}%c ${msg}`, STYLE, "color:#7C8DA6", "color:#1DB954;font-weight:700", "color:inherit"];
    if (data !== undefined) args.push(data);
    (console[level] || console.log)(...args);
  }
  window.AplyerLog = {
    info: (scope, msg, data) => emit("log", scope, msg, data),
    warn: (scope, msg, data) => emit("warn", scope, msg, data),
    error: (scope, msg, data) => emit("error", scope, msg, data),
    debug: (scope, msg, data) => emit("debug", scope, msg, data),
  };
})();
