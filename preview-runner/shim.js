// Injected at the top of every preview document. Runs inside the sandboxed,
// opaque-origin preview. It only *sends* diagnostics to the parent window; it
// never receives commands, so a compromised preview gains nothing from it.
(function () {
  var post = function (msg) {
    try {
      msg.source = "deck3d-preview";
      parent.postMessage(msg, "*");
    } catch {
      /* ignore */
    }
  };
  var fmt = function (v) {
    try {
      if (v instanceof Error) return (v.name || "Error") + ": " + v.message;
      if (typeof v === "string") return v;
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  var sent = 0;
  var report = function (kind, message, stack, file, line, col) {
    if (sent++ > 50) return; // bounded: a render loop error must not flood the parent
    post({
      type: kind,
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 4000) : "",
      file: file ? String(file).replace(location.origin, "") : "",
      line: line || 0,
      column: col || 0,
    });
  };
  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      report("resource-error", "Failed to load " + (e.target.src || e.target.href), "", "", 0, 0);
      return;
    }
    report("runtime-error", e.message, e.error && e.error.stack, e.filename, e.lineno, e.colno);
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    report("runtime-error", "Unhandled promise rejection: " + fmt(r), r && r.stack, "", 0, 0);
  });
  var origError = console.error;
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
    report("console-error", parts.join(" "), "", "", 0, 0);
    return origError.apply(console, arguments);
  };
  document.addEventListener("securitypolicyviolation", function (e) {
    report("csp-violation", "Blocked by preview sandbox policy: " + e.violatedDirective + " " + (e.blockedURI || ""), "", "", 0, 0);
  });

  // Opaque-origin documents cannot use Web Storage; provide an in-memory stand-in.
  function MemoryStorage() {
    var data = {};
    return {
      get length() { return Object.keys(data).length; },
      key: function (i) { return Object.keys(data)[i] || null; },
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = {}; },
    };
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try {
      var s = window[name];
      s.getItem("__probe");
    } catch {
      try {
        Object.defineProperty(window, name, { value: MemoryStorage(), configurable: true });
      } catch { /* ignore */ }
    }
  });

  var t0 = performance.now();
  window.addEventListener("load", function () {
    post({ type: "ready", loadMs: Math.round(performance.now() - t0) });
  });
})();
