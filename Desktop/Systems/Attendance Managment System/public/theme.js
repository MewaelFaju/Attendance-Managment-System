// Runs in <head> before first paint so a saved dark/light choice doesn't flash the wrong theme.
(() => {
  try {
    const saved = localStorage.getItem('attendance.theme');
    if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  } catch {
    // storage unavailable: fall back to the OS preference
  }
})();
