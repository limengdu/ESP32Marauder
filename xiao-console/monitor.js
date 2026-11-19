const LAYOUT_KEY = 'xiao-console-monitor-layout';
const MIN_RATIO = 0.25;
const MAX_RATIO = 0.6;

/**
 * Attach sizing and output controls to the persistent workspace monitor.
 * 为工作台常驻监视器绑定分区尺寸与输出控制。
 */
export function setupMonitor() {
  const workspace = document.getElementById('workspace');
  const panel = document.getElementById('console');
  const splitter = document.getElementById('monitor-splitter');
  const log = document.getElementById('log');
  const autoScroll = document.getElementById('auto-scroll');
  const expand = document.getElementById('monitor-expand');
  const stacked = window.matchMedia('(max-width: 1100px)');
  let widthRatio = 0.36;
  let heightRatio = 0.42;
  let fontSize = 12;
  let restoreRatio = null;
  let dragging = false;
  let scrollScheduled = false;

  function savePreferences() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ widthRatio, heightRatio, fontSize }));
    } catch (error) {
      console.warn('Monitor preference unavailable', error);
    }
  }

  function scrollToEnd() {
    if (autoScroll.checked) log.scrollTop = log.scrollHeight;
  }

  function open() {
    scrollToEnd();
    const command = document.getElementById('command');
    if (!command.disabled) command.focus({ preventScroll: true });
    else log.focus({ preventScroll: true });
  }

  function currentRatio() {
    return stacked.matches ? heightRatio : widthRatio;
  }

  function updateLayout() {
    const minimum = Math.min(MAX_RATIO, Math.max(MIN_RATIO, (stacked.matches ? 200 : 340) / splitBounds().size));
    if (stacked.matches) heightRatio = Math.max(minimum, heightRatio);
    else widthRatio = Math.max(minimum, widthRatio);
    workspace.style.setProperty('--monitor-width', `${widthRatio * 100}%`);
    workspace.style.setProperty('--monitor-height', `${heightRatio * 100}%`);
    splitter.setAttribute('aria-orientation', stacked.matches ? 'horizontal' : 'vertical');
    splitter.setAttribute('aria-valuemin', String(Math.round(minimum * 100)));
    splitter.setAttribute('aria-valuenow', String(Math.round(currentRatio() * 100)));
    expand.setAttribute('aria-pressed', String(restoreRatio !== null));
    expand.textContent = stacked.matches ? '↕' : '↔';
    scrollToEnd();
  }

  function setRatio(ratio) {
    const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
    if (stacked.matches) heightRatio = clamped;
    else widthRatio = clamped;
    updateLayout();
  }

  /**
   * Measure the space shared by the content, divider and monitor.
   * 测量内容区、分隔条与监视器共同占用的空间。
   */
  function splitBounds() {
    const box = workspace.getBoundingClientRect();
    const style = getComputedStyle(workspace);
    return stacked.matches
      ? { end: box.bottom - parseFloat(style.paddingBottom), size: workspace.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) }
      : { end: box.right - parseFloat(style.paddingRight), size: workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
  }

  function toggleExpand() {
    if (restoreRatio === null) {
      restoreRatio = currentRatio();
      setRatio(0.56);
    } else {
      const ratio = restoreRatio;
      restoreRatio = null;
      setRatio(ratio);
    }
    savePreferences();
  }

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    restoreRatio = null;
    splitter.setPointerCapture(event.pointerId);
    workspace.classList.add('resizing');
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const bounds = splitBounds();
    const position = stacked.matches ? event.clientY : event.clientX;
    setRatio((bounds.end - position) / bounds.size);
  });
  function endResize() {
    if (!dragging) return;
    dragging = false;
    workspace.classList.remove('resizing');
    savePreferences();
  }
  splitter.addEventListener('pointerup', endResize);
  splitter.addEventListener('pointercancel', endResize);
  splitter.addEventListener('lostpointercapture', endResize);
  splitter.addEventListener('dblclick', () => {
    restoreRatio = null;
    setRatio(stacked.matches ? 0.42 : 0.36);
    savePreferences();
  });
  splitter.addEventListener('keydown', (event) => {
    const decrease = stacked.matches ? 'ArrowDown' : 'ArrowRight';
    const increase = stacked.matches ? 'ArrowUp' : 'ArrowLeft';
    if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    restoreRatio = null;
    if (event.key === 'Home') setRatio(MIN_RATIO);
    else if (event.key === 'End') setRatio(MAX_RATIO);
    else setRatio(currentRatio() + (event.key === increase ? 20 : -20) / splitBounds().size);
    savePreferences();
  });

  document.querySelectorAll('[data-open-monitor]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); open(); }));
  expand.addEventListener('click', toggleExpand);
  autoScroll.addEventListener('change', scrollToEnd);
  document.getElementById('font-smaller').addEventListener('click', () => setFont(fontSize - 1));
  document.getElementById('font-larger').addEventListener('click', () => setFont(fontSize + 1));
  document.getElementById('log-filter').addEventListener('input', (event) => {
    log.dataset.filter = event.target.value;
    scrollToEnd();
  });

  function setFont(size) {
    fontSize = Math.max(10, Math.min(24, size));
    panel.style.setProperty('--monitor-font-size', `${fontSize}px`);
    document.getElementById('font-size').textContent = `${fontSize}px`;
    savePreferences();
  }

  stacked.addEventListener('change', () => {
    restoreRatio = null;
    updateLayout();
  });
  window.addEventListener('resize', updateLayout);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.code === 'Backquote') {
      event.preventDefault();
      open();
    }
  });
  new ResizeObserver(scrollToEnd).observe(log);

  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (Number.isFinite(saved?.widthRatio)) widthRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, saved.widthRatio));
    if (Number.isFinite(saved?.heightRatio)) heightRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, saved.heightRatio));
    if (Number.isFinite(saved?.fontSize)) fontSize = saved.fontSize;
  } catch (error) {
    console.warn('Monitor preference unavailable', error);
  }
  setFont(fontSize);
  updateLayout();

  return {
    open,
    lineAdded() {
      if (autoScroll.checked && !scrollScheduled) {
        scrollScheduled = true;
        requestAnimationFrame(() => {
          scrollScheduled = false;
          scrollToEnd();
        });
      }
    },
    clear: scrollToEnd,
  };
}
