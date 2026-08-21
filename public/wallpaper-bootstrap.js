(() => {
  const fallback = '#ffffff';
  let background = fallback;
  try {
    const value = JSON.parse(localStorage.getItem('isu:wallpaper-bootstrap-preview') || 'null');
    if (value && typeof value.background === 'string' && value.background.length <= 65536) {
      const candidate = value.background;
      const local = /^#[0-9a-f]{6}$/i.test(candidate)
        || /^data:image\/(?:webp|png|jpeg);base64,[a-z0-9+/=]+$/i.test(candidate)
        || /^(?=(?:linear|radial)-gradient\()[#a-z0-9%(),.\s-]+$/i.test(candidate);
      const remote = /^url\("(https:\/\/[^"\\]+)"\)$/.exec(candidate);
      if (local || (remote && new URL(remote[1]).hostname === 'images.unsplash.com')) background = candidate;
    }
  } catch {}
  const root = document.documentElement;
  root.style.background = background;
  root.style.backgroundPosition = 'center';
  root.style.backgroundSize = 'cover';
  root.style.backgroundAttachment = 'fixed';
})();
