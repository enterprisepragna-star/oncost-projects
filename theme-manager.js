// Theme Manager for ONCOST
document.addEventListener('DOMContentLoaded', () => {
  // Define themes and their date ranges (Month is 0-indexed: 0 = Jan, 11 = Dec)
  const festivals = [
    // Add festivals here when needed. E.g.:
    // { name: 'diwali', startMonth: 9, startDay: 15, endMonth: 10, endDay: 15 }
  ];

  let particleInterval = null;
  const particleContainerId = 'theme-particles';

  function stopParticles() {
    if (particleInterval) {
      clearInterval(particleInterval);
      particleInterval = null;
    }
    const container = document.getElementById(particleContainerId);
    if (container) container.remove();
  }

  function startParticles(themeName) {
    stopParticles();
    
    let emojis = [];
    if (themeName === 'diwali') emojis = ['✨', '🪔', '🎇'];
    else if (themeName === 'christmas') emojis = ['❄️', '⛄', '🎁'];
    else if (themeName === 'independence') emojis = ['🏵️', '✨', '🎈'];
    else return;

    const container = document.createElement('div');
    container.id = particleContainerId;
    container.className = 'particle-container';
    document.body.appendChild(container);

    particleInterval = setInterval(() => {
      // Don't spawn if page is hidden to save performance
      if (document.hidden) return;
      
      const p = document.createElement('div');
      p.className = 'particle';
      p.innerText = emojis[Math.floor(Math.random() * emojis.length)];
      
      // Randomize start position, size, and duration
      p.style.left = Math.random() * 100 + 'vw';
      const size = Math.random() * 15 + 12; // 12px to 27px
      p.style.fontSize = size + 'px';
      const duration = Math.random() * 3 + 4; // 4s to 7s
      p.style.animationDuration = duration + 's';
      
      container.appendChild(p);

      // Clean up after animation finishes
      setTimeout(() => {
        if (p.parentNode) p.remove();
      }, duration * 1000);
    }, 450); // Spawn a particle every 450ms
  }

  function applyTheme(themeName) {
    // Remove all theme classes first
    document.body.classList.remove('theme-diwali', 'theme-christmas', 'theme-independence');
    
    if (themeName && themeName !== 'default') {
      document.body.classList.add(`theme-${themeName}`);
      localStorage.setItem('oncost_active_theme', themeName);
      startParticles(themeName);
      // Make sure the sale banner has some content if empty, so the pulsing effect is visible
      const banner = document.getElementById('sale-banner');
      if (banner && !banner.innerHTML.trim()) {
         banner.innerHTML = `<span class="pill">Festive Offer</span> Enjoy exclusive gifting rates for ${themeName.charAt(0).toUpperCase() + themeName.slice(1)}!`;
      }
    } else {
      localStorage.removeItem('oncost_active_theme');
      stopParticles();
      const banner = document.getElementById('sale-banner');
      if (banner) banner.style.display = 'none'; // reset
    }
  }

  function checkFestivals() {
    // Check local storage first (for testing overrides)
    const savedTheme = localStorage.getItem('oncost_active_theme');
    if (savedTheme) {
      applyTheme(savedTheme);
      return;
    }

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentDate = today.getDate();

    let activeTheme = 'default';

    for (const fest of festivals) {
      if (currentMonth >= fest.startMonth && currentMonth <= fest.endMonth) {
        if (currentMonth === fest.startMonth && currentDate < fest.startDay) continue;
        if (currentMonth === fest.endMonth && currentDate > fest.endDay) continue;
        
        activeTheme = fest.name;
        break;
      }
    }

    applyTheme(activeTheme);
  }

  checkFestivals();
});
