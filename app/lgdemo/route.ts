const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>LG StanbyME Demo | FLYR</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #000;
      color: #fff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      touch-action: manipulation;
    }
    button { font: inherit; color: inherit; cursor: pointer; }
    .stage {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      background: #000;
    }
    .slide {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0;
      transition: opacity .18s ease;
      pointer-events: none;
      user-select: none;
      -webkit-user-drag: none;
    }
    .slide.active { opacity: 1; }
    .tap-marker {
      position: fixed;
      z-index: 6;
      width: 74px;
      height: 74px;
      margin: -37px 0 0 -37px;
      padding: 0;
      border: 5px solid rgba(255,59,48,.96);
      border-radius: 999px;
      background: transparent;
      box-shadow: 0 0 0 5px rgba(255,255,255,.78), 0 12px 30px rgba(0,0,0,.22);
      opacity: 0;
      pointer-events: none;
      transform: scale(.84);
      appearance: none;
    }
    .tap-marker.active {
      opacity: 1;
      pointer-events: auto;
      animation: tapPulse 1.15s ease-in-out infinite;
    }
    @keyframes tapPulse {
      0%, 100% { transform: scale(.82); box-shadow: 0 0 0 5px rgba(255,255,255,.78), 0 12px 30px rgba(0,0,0,.22); }
      50% { transform: scale(1.08); box-shadow: 0 0 0 14px rgba(255,59,48,.2), 0 12px 30px rgba(0,0,0,.22); }
    }
    .hud {
      position: fixed;
      left: 50%;
      bottom: max(12px, env(safe-area-inset-bottom));
      z-index: 5;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 10px;
      width: min(94vw, 620px);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .nav-group { display: flex; gap: 8px; pointer-events: auto; }
    .nav-group.right { justify-self: end; }
    .btn {
      min-width: 72px;
      height: 46px;
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 999px;
      background: rgba(0,0,0,.42);
      box-shadow: 0 12px 32px rgba(0,0,0,.24);
      color: #fff;
      font-weight: 900;
      backdrop-filter: blur(10px);
    }
    .btn.primary {
      min-width: 86px;
      border-color: rgba(255,59,48,.72);
      background: rgba(255,59,48,.9);
    }
    .counter {
      justify-self: center;
      min-width: 76px;
      padding: 8px 13px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 999px;
      background: rgba(0,0,0,.34);
      color: rgba(255,255,255,.9);
      text-align: center;
      font-size: 13px;
      font-weight: 900;
      backdrop-filter: blur(10px);
    }
    .missing {
      position: fixed;
      inset: 0;
      z-index: 1;
      display: none;
      place-items: center;
      padding: 24px;
      color: #fff;
      text-align: center;
      font-size: 22px;
      font-weight: 900;
      line-height: 1.25;
      white-space: pre-line;
      background: #111;
    }
    .missing.active { display: grid; }
    .loader {
      position: fixed;
      inset: 0;
      z-index: 8;
      display: grid;
      place-items: center;
      padding: 28px;
      background: rgba(0,0,0,.78);
      opacity: 1;
      transition: opacity .2s ease;
      pointer-events: auto;
    }
    .loader.hidden {
      opacity: 0;
      pointer-events: none;
    }
    .loader-card {
      width: min(78vw, 360px);
      padding: 22px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 18px;
      background: rgba(18,18,18,.84);
      box-shadow: 0 24px 70px rgba(0,0,0,.4);
      text-align: center;
      backdrop-filter: blur(14px);
    }
    .loader-title {
      margin: 0 0 8px;
      font-size: 21px;
      font-weight: 950;
    }
    .loader-count {
      margin: 0 0 16px;
      color: rgba(255,255,255,.72);
      font-size: 14px;
      font-weight: 800;
    }
    .loader-track {
      height: 9px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255,255,255,.14);
    }
    .loader-fill {
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: #ff3b30;
      transition: width .16s ease;
    }
    @media (max-width: 760px) {
      .hud { width: calc(100vw - 18px); gap: 8px; }
      .btn { min-width: 62px; height: 44px; font-size: 14px; }
      .btn.primary { min-width: 78px; }
      .counter { min-width: 66px; padding: 7px 10px; font-size: 12px; }
    }
  </style>
</head>
<body>
  <main class="stage" aria-label="FLYR LG demo slideshow">
    <img class="slide active" data-slide-a alt="FLYR demo slide" />
    <img class="slide" data-slide-b alt="" aria-hidden="true" />
    <div class="missing" data-missing></div>
  </main>
  <button class="tap-marker" data-tap-marker data-next aria-label="Continue demo"></button>
  <div class="loader" data-loader aria-live="polite">
    <div class="loader-card">
      <p class="loader-title">Preparing demo</p>
      <p class="loader-count" data-loader-count>Downloading slides 0 / 18</p>
      <div class="loader-track"><div class="loader-fill" data-loader-fill></div></div>
    </div>
  </div>

  <nav class="hud" aria-label="Demo controls">
    <div class="nav-group"><button class="btn" data-back>Back</button></div>
    <div class="counter" data-counter>1 / 18</div>
    <div class="nav-group right">
      <button class="btn" data-reset>Reset</button>
      <button class="btn primary" data-next>Next</button>
    </div>
  </nav>

  <script>
    var files = [
      "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg", "7.jpg", "8.jpg", "9.jpg", "10.jpg",
      "11.jpg", "12.jpg", "13.jpg", "14.jpg", "15.jpg", "16.jpg", "17.jpg", "18.png"
    ];
    var tapPoints = [
      [50, 87], [79, 58], [66, 31], [50, 86], [50, 29], [50, 87], [50, 72], [84, 15], [84, 15], [84, 15],
      [84, 15], [77, 32], [83, 87], [35, 87], [84, 15], [84, 15], [84, 15], null
    ];
    var index = 0;
    var requestId = 0;
    var ready = false;
    var cachedSlides = [];
    var loadedSlides = 0;
    var active = document.querySelector("[data-slide-a]");
    var standby = document.querySelector("[data-slide-b]");
    var missing = document.querySelector("[data-missing]");
    var counter = document.querySelector("[data-counter]");
    var tapMarker = document.querySelector("[data-tap-marker]");
    var loader = document.querySelector("[data-loader]");
    var loaderCount = document.querySelector("[data-loader-count]");
    var loaderFill = document.querySelector("[data-loader-fill]");

    function srcFor(i) {
      return "/lgdemo/sequence-lg/" + files[i];
    }
    function preload(i) {
      if (i < 0 || i >= files.length) return;
      if (cachedSlides[i]) return;
      var img = new Image();
      img.src = srcFor(i);
    }
    function setLoaderProgress() {
      loaderCount.textContent = "Downloading slides " + loadedSlides + " / " + files.length;
      loaderFill.style.width = Math.round(loadedSlides / files.length * 100) + "%";
    }
    function cacheSlide(i, done) {
      if (cachedSlides[i]) {
        done();
        return;
      }
      var img = new Image();
      img.onload = function() {
        cachedSlides[i] = img;
        loadedSlides++;
        setLoaderProgress();
        done();
      };
      img.onerror = function() {
        loadedSlides++;
        setLoaderProgress();
        done();
      };
      img.src = srcFor(i);
    }
    function cacheAllSlides() {
      var nextToLoad = 0;
      var activeLoads = 0;
      var maxLoads = 3;
      function pump() {
        while (activeLoads < maxLoads && nextToLoad < files.length) {
          activeLoads++;
          cacheSlide(nextToLoad, function() {
            activeLoads--;
            if (loadedSlides >= files.length) {
              ready = true;
              loader.className = "loader hidden";
              updateTapMarker();
              return;
            }
            pump();
          });
          nextToLoad++;
        }
      }
      setLoaderProgress();
      pump();
    }
    function showMissing(file) {
      missing.textContent = "Missing slide:\\npublic/lgdemo/sequence-lg/" + file;
      missing.className = "missing active";
      tapMarker.className = "tap-marker";
    }
    function updateTapMarker() {
      var point = tapPoints[index];
      if (!point || !active.naturalWidth || !active.naturalHeight) {
        tapMarker.className = "tap-marker";
        return;
      }
      var viewportW = window.innerWidth;
      var viewportH = window.innerHeight;
      var imageRatio = active.naturalWidth / active.naturalHeight;
      var viewportRatio = viewportW / viewportH;
      var renderedW = viewportW;
      var renderedH = viewportH;
      var offsetX = 0;
      var offsetY = 0;
      if (viewportRatio > imageRatio) {
        renderedW = viewportH * imageRatio;
        offsetX = (viewportW - renderedW) / 2;
      } else {
        renderedH = viewportW / imageRatio;
        offsetY = (viewportH - renderedH) / 2;
      }
      tapMarker.style.left = (offsetX + renderedW * point[0] / 100) + "px";
      tapMarker.style.top = (offsetY + renderedH * point[1] / 100) + "px";
      tapMarker.className = "tap-marker";
      void tapMarker.offsetWidth;
      tapMarker.className = "tap-marker active";
    }
    function render(nextIndex, instant) {
      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex >= files.length) nextIndex = files.length - 1;
      index = nextIndex;
      requestId++;
      var currentRequest = requestId;
      var nextSrc = srcFor(index);
      counter.textContent = (index + 1) + " / " + files.length;
      if (active.getAttribute("src") === nextSrc && active.className.indexOf("active") !== -1) {
        missing.className = "missing";
        updateTapMarker();
        preload(index + 1);
        preload(index - 1);
        return;
      }
      standby.onload = function() {
        if (currentRequest !== requestId) return;
        missing.className = "missing";
        if (instant) {
          standby.style.transition = "none";
          active.style.transition = "none";
        }
        standby.className = "slide active";
        active.className = "slide";
        var swap = active;
        active = standby;
        standby = swap;
        standby.removeAttribute("src");
        if (instant) {
          void active.offsetWidth;
          active.style.transition = "";
          standby.style.transition = "";
        }
        updateTapMarker();
        preload(index + 1);
        preload(index - 1);
      };
      standby.onerror = function() {
        if (currentRequest !== requestId) return;
        showMissing(files[index]);
      };
      standby.src = nextSrc;
    }
    function next() {
      if (!ready) return;
      render(index >= files.length - 1 ? 0 : index + 1, false);
    }
    function back() {
      if (!ready) return;
      render(index - 1, false);
    }
    document.addEventListener("click", function(event) {
      var target = event.target;
      while (target && target !== document && !target.hasAttribute("data-next") && !target.hasAttribute("data-back") && !target.hasAttribute("data-reset")) {
        target = target.parentNode;
      }
      if (!target || target === document) return;
      if (target.hasAttribute("data-next")) next();
      if (target.hasAttribute("data-back")) back();
      if (target.hasAttribute("data-reset") && ready) render(0, false);
    });
    document.addEventListener("keydown", function(event) {
      if (event.key === "ArrowRight" || event.key === " ") next();
      if (event.key === "ArrowLeft") back();
      if (event.key === "Home") render(0, false);
    });
    window.addEventListener("resize", updateTapMarker);
    render(0, true);
    cacheAllSlides();
  </script>
</body>
</html>`;

export function GET() {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
