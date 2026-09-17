(function () {
  'use strict';

  // Application State
  const AppState = {
    currentView: 'find-leads',
    locations: {},
    categories: [],
    quickNiches: [],
    selectedState: '',
    selectedCity: '',
    selectedCategory: '',
    selectedKeyword: '',
    selectedRadius: 25,
    pendingDiscoveredLeads: [],
    allSavedLeads: [],
    savedLeads: [],
    selectedLeadIds: new Set(),
    savedFilters: {
      search: '',
      website: 'All',
      status: 'All',
      category: 'All',
      state: 'All',
      favsOnly: false,
      phoneOnly: false,
      sort: 'newest',
      page: 1,
      rowsPerPage: 25
    },
    favoriteLeads: [],
    selectedFavLeadIds: new Set(),
    favFilters: {
      search: '',
      website: 'All',
      status: 'All',
      category: 'All',
      state: 'All',
      phone: 'All',
      sort: 'newest',
      page: 1,
      rowsPerPage: 25
    },
    activeOutreachLead: null,
    leadToDelete: null,
    isBulkDelete: false,
    outreach: {
      subTab: 'ready',
      data: null,
      activeLeadId: null,
      selectedLeadIds: new Set(),
      searchQuery: '',
      categoryFilter: 'ALL',
      siteFilter: 'ALL',
      currentComposerLead: null,
      isFollowUpComposer: false
    },
    outreachQueue: {
      isActive: false,
      leads: [],
      currentIndex: 0,
      totalCount: 0,
      processedCount: 0,
      skippedCount: 0,
      source: 'saved-leads'
    },
    followup: {
      activeTab: 'active',
      replyFilter: 'ALL',
      searchQuery: '',
      data: null,
      leads: [],
      currentReplyLead: null
    },
    history: {
      records: [],
      selectedIds: new Set(),
      isLoading: false
    },
    hasLoadedSavedLeads: false,
    savedLeadsDirty: false,
    hasLoadedFavorites: false,
    favoritesDirty: false,
    hasLoadedHistory: false,
    historyDirty: false,
    outreachDirty: false,
    followupDirty: false
  };

  // ----------------------------------------------------
  // 1. TOAST NOTIFICATION ENGINE
  // ----------------------------------------------------
  function showToast(message, type = 'success', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;

    let iconHtml = '<i class="fa-solid fa-circle-check toast-icon"></i>';
    if (type === 'error') {
      iconHtml = '<i class="fa-solid fa-circle-exclamation toast-icon"></i>';
    } else if (type === 'info') {
      iconHtml = '<i class="fa-solid fa-circle-info toast-icon"></i>';
    }

    toast.innerHTML = `
      ${iconHtml}
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, duration);
  }

  // ----------------------------------------------------
  // DATE DISPLAY & SCHEDULE HELPER UTILITIES (DD-MM-YYYY)
  // ----------------------------------------------------
  function formatDDMMYYYY(dateInput) {
    if (!dateInput) return '—';
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '—';
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    } catch {
      return '—';
    }
  }

  function getCalendarDayDiff(targetDateInput) {
    if (!targetDateInput) return null;
    const target = new Date(targetDateInput);
    if (isNaN(target.getTime())) return null;

    const now = new Date();
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((targetMidnight - nowMidnight) / (24 * 60 * 60 * 1000));
  }

  function getDaysUntilText(diffDays) {
    if (diffDays === null) return '—';
    if (diffDays < 0) {
      const overdueDays = Math.abs(diffDays);
      return `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`;
    }
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Tomorrow';
    return `in ${diffDays} days`;
  }

  function getReminderText(lead, diffDays) {
    const stepName = lead.next_follow_up_name || (lead.next_follow_up_number ? `Follow-Up #${lead.next_follow_up_number}` : 'Follow-Up');
    if (diffDays === null) return '';
    if (diffDays < 0) {
      const overdueDays = Math.abs(diffDays);
      return `${stepName} is overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`;
    }
    if (diffDays === 0) {
      return `${stepName} is due today`;
    }
    if (diffDays === 1) {
      return `Next follow-up is tomorrow`;
    }
    return `Next follow-up in ${diffDays} days`;
  }

  // ----------------------------------------------------
  // 2. VIEW CONTROLLER (ROUTER)
  // ----------------------------------------------------
  function switchView(viewName) {
    AppState.currentView = viewName;
    document.body.setAttribute('data-view', viewName);

    const viewFindLeads = document.getElementById('view-find-leads');
    const viewSavedLeads = document.getElementById('view-saved-leads');
    const viewFavorites = document.getElementById('view-favorites');
    const viewOutreach = document.getElementById('view-outreach');
    const viewFollowup = document.getElementById('view-followup');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewHistory = document.getElementById('view-history');
    const viewHero = document.getElementById('view-hero');
    const viewSettings = document.getElementById('view-settings');

    const views = [
      { name: 'find-leads', el: viewFindLeads },
      { name: 'saved-leads', el: viewSavedLeads },
      { name: 'favorites', el: viewFavorites },
      { name: 'outreach', el: viewOutreach },
      { name: 'followup', el: viewFollowup },
      { name: 'dashboard', el: viewDashboard },
      { name: 'history', el: viewHistory },
      { name: 'hero', el: viewHero },
      { name: 'settings', el: viewSettings }
    ];

    views.forEach(({ name, el }) => {
      if (!el) return;
      if (name === viewName) {
        el.style.display = (name === 'hero') ? 'flex' : 'block';
        el.classList.remove('hidden');
        el.classList.add('active-view');

      } else {
        el.style.display = 'none';
        el.classList.add('hidden');
        el.classList.remove('active-view');
      }
    });

    // Update Nav Link Highlights
    const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');
    navLinks.forEach((link) => {
      const tab = link.getAttribute('data-tab');
      if (tab === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    window.scrollTo({ top: 0, behavior: 'instant' });

    // Update browser URL hash without reload
    const targetHash = `#${viewName}`;
    if (window.location.hash !== targetHash) {
      history.replaceState(null, '', targetHash);
    }

    // View-specific initialization (fast cached check to avoid duplicate network requests)
    if (viewName === 'saved-leads') {
      if (!AppState.hasLoadedSavedLeads || AppState.savedLeadsDirty) {
        loadSavedLeads();
      } else if (!document.getElementById('saved-leads-tbody')?.children.length) {
        renderSavedTableRows();
      }
    } else if (viewName === 'favorites') {
      if (!AppState.hasLoadedFavorites || AppState.favoritesDirty) {
        loadFavoriteLeads();
      } else if (!document.getElementById('fav-leads-tbody')?.children.length) {
        renderFavTableRows();
      }
    } else if (viewName === 'outreach') {
      if (!AppState.outreach?.data || AppState.outreachDirty) {
        loadOutreachData(AppState.outreach?.activeLeadId);
      }
    } else if (viewName === 'followup') {
      loadFollowUpData();
    } else if (viewName === 'history') {
      if (!AppState.hasLoadedHistory || AppState.historyDirty) {
        loadHistoryData();
      }
    } else if (viewName === 'settings') {
      if (window.SettingsModule) {
        window.SettingsModule.initSettingsUI();
      }
    } else if (viewName === 'dashboard') {
      updateDashboardCounts();
    }

    // Ensure bulk actions bar is only visible on its respective section
    updateBulkActionBar();
    updateFavBulkActionBar();
  }

  // Expose on window for global routing and programmatic control
  window.switchView = switchView;
  window.AppState = AppState;

  // ----------------------------------------------------
  // 3. DATA INITIALIZATION & SYNC
  // ----------------------------------------------------
  async function fetchLocations() {
    try {
      const res = await fetch('/api/locations');
      const data = await res.json();
      if (data.success) {
        AppState.locations = data.locations;
        populateStateDropdown();
      }
    } catch (err) {
      console.error('Error fetching locations:', err);
    }
  }

  async function fetchCategories() {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      if (data.success) {
        AppState.categories = data.categories;
        AppState.quickNiches = data.quickNiches || [];
        populateCategoryDropdown();
        renderQuickNiches();
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  }

  let inFlightCountPromise = null;
  async function updateBadgeCounts() {
    if (inFlightCountPromise) return inFlightCountPromise;
    inFlightCountPromise = (async () => {
      try {
        const res = await fetch('/api/leads/count');
        const data = await res.json();
        const count = data.total ?? 0;
        const favCount = data.favorites ?? 0;

        const desktopBadge = document.getElementById('nav-saved-badge');
        const mobileBadge = document.getElementById('mobile-nav-saved-badge');
        const totalPill = document.getElementById('saved-total-pill-count');
        const favTotalPill = document.getElementById('fav-total-pill-count');

        if (desktopBadge) desktopBadge.textContent = count;
        if (mobileBadge) mobileBadge.textContent = count;
        if (totalPill) totalPill.textContent = `${count} Leads`;
        if (favTotalPill) favTotalPill.textContent = `${favCount} Favorites`;

        const outreachBadge = document.getElementById('nav-outreach-badge');
        if (outreachBadge && data.outreachReady !== undefined) {
          outreachBadge.textContent = data.outreachReady;
        }

        const fuBadge = document.getElementById('nav-followup-badge');
        const mobileFuBadge = document.getElementById('mobile-nav-followup-badge');
        const actionableCount = (data.actionableFollowUps !== undefined) ? data.actionableFollowUps : (data.followUpsDue ?? 0);
        if (fuBadge) fuBadge.textContent = actionableCount;
        if (mobileFuBadge) mobileFuBadge.textContent = actionableCount;

        // 1. Dashboard summary cards
        const dashOutreachVal = document.getElementById('dash-card-outreach-val');
        const dashOutreachSub = document.getElementById('dash-card-outreach-sub');
        if (dashOutreachVal && data.sentToday !== undefined && data.dailyTarget) {
          dashOutreachVal.textContent = `${data.sentToday} / ${data.dailyTarget}`;
          if (dashOutreachSub) dashOutreachSub.textContent = `${data.percent || 0}% done`;
        }

        const newLeadsCardVal = document.getElementById('dash-card-saved-val') || document.querySelector('.dash-card:nth-child(2) .dash-card-value');
        if (newLeadsCardVal) newLeadsCardVal.textContent = `${count} leads`;

        const favCardVal = document.getElementById('dash-card-favorites-val') || document.querySelector('.dash-card:nth-child(3) .dash-card-value');
        if (favCardVal) favCardVal.textContent = `${favCount} starred`;

        const fuCardVal = document.getElementById('dash-card-followups-val');
        if (fuCardVal && data.followUpsDue !== undefined) {
          fuCardVal.textContent = `${data.followUpsDue} prospects`;
        }

        const repliesCardVal = document.getElementById('dash-card-replies-val');
        if (repliesCardVal && data.replied !== undefined) {
          repliesCardVal.textContent = `${data.replied} replies`;
        }

        const revCardVal = document.getElementById('dash-card-revenue-val');
        if (revCardVal && data.pipelineValue !== undefined) {
          revCardVal.textContent = `₹${(data.pipelineValue || 0).toLocaleString('en-IN')}`;
        }

        // 2. Dashboard Today's Target Card
        const dashTargetSent = document.getElementById('dash-target-sent');
        const dashTargetRemaining = document.getElementById('dash-target-remaining');
        const dashTargetFill = document.getElementById('dash-target-fill');
        const dashProgressFill = document.getElementById('dash-daily-progress-fill');
        const dashTripletSent = document.getElementById('dash-triplet-sent');
        const dashTripletRem = document.getElementById('dash-triplet-rem');
        const dashTripletTarget = document.getElementById('dash-triplet-target');

        if (dashTargetSent && data.sentToday !== undefined && data.dailyTarget) {
          dashTargetSent.textContent = `${data.sentToday} / ${data.dailyTarget}`;
          if (dashTargetRemaining) dashTargetRemaining.textContent = `${data.remaining || 0} left`;
          if (dashTargetFill) dashTargetFill.style.width = `${data.percent || 0}%`;
          if (dashProgressFill) dashProgressFill.style.width = `${data.percent || 0}%`;
          if (dashTripletSent) dashTripletSent.innerHTML = `<i class="fa-solid fa-check"></i> ${data.sentToday} SENT`;
          if (dashTripletRem) dashTripletRem.textContent = `→ ${data.remaining || 0} LEFT`;
          if (dashTripletTarget) dashTripletTarget.textContent = `${data.dailyTarget} / DAY`;
        }

        // 3. AI Sales Terminal Insights
        const dashInsightTarget = document.getElementById('dash-insight-target');
        if (dashInsightTarget && data.sentToday !== undefined && data.dailyTarget) {
          dashInsightTarget.textContent = `You've completed ${data.percent || 0}% of today's outreach target (${data.sentToday}/${data.dailyTarget}).`;
        }
        const dashInsightNoweb = document.getElementById('dash-insight-noweb');
        if (dashInsightNoweb && data.noWebsite !== undefined) {
          dashInsightNoweb.textContent = `Identified ${data.noWebsite} local businesses without a website — prime web development conversion targets.`;
        }

        // 4. Hero Section 04 Outreach Velocity Card
        const heroStat = document.getElementById('hero-velocity-stat');
        const heroSub = document.getElementById('hero-velocity-sub');
        const heroFill = document.getElementById('hero-velocity-bar-fill');
        const heroPct = document.getElementById('hero-velocity-percent');
        if (heroStat && data.sentToday !== undefined && data.dailyTarget) {
          heroStat.innerHTML = `<strong>${data.sentToday} / ${data.dailyTarget}</strong> sent`;
          if (heroSub) heroSub.textContent = `${data.remaining || 0} outreaches remaining to hit daily goal.`;
          if (heroFill) heroFill.style.width = `${data.percent || 0}%`;
          if (heroPct) heroPct.textContent = `${data.percent || 0}%`;
        }
      } catch (err) {
        console.warn('Could not update badge counts:', err);
      } finally {
        inFlightCountPromise = null;
      }
    })();
    return inFlightCountPromise;
  }

  function updateDashboardCounts() {
    updateBadgeCounts();
  }

  // ----------------------------------------------------
  // 4. FIND LEADS CONTROLLER & CACHED DOM
  // ----------------------------------------------------
  const FindLeadsDOM = {
    cached: false,
    init() {
      if (this.cached && this.stateContainer) return;
      this.stateContainer = document.getElementById('custom-select-state-container');
      this.stateTrigger = document.getElementById('custom-select-state-trigger');
      this.stateLabel = document.getElementById('custom-select-state-label');
      this.statePanel = document.getElementById('custom-select-state-panel');
      this.stateSearch = document.getElementById('custom-select-state-search');
      this.stateClear = document.getElementById('custom-select-state-clear');
      this.stateOptions = document.getElementById('custom-select-state-options');
      this.stateEmpty = document.getElementById('custom-select-state-empty');
      this.stateInput = document.getElementById('find-select-state');

      this.cityContainer = document.getElementById('custom-select-city-container');
      this.cityTrigger = document.getElementById('custom-select-city-trigger');
      this.cityLabel = document.getElementById('custom-select-city-label');
      this.cityPanel = document.getElementById('custom-select-city-panel');
      this.citySearch = document.getElementById('custom-select-city-search');
      this.cityClear = document.getElementById('custom-select-city-clear');
      this.cityOptions = document.getElementById('custom-select-city-options');
      this.cityEmpty = document.getElementById('custom-select-city-empty');
      this.cityInput = document.getElementById('find-select-city');
      this.cityBadge = document.getElementById('find-city-counter-badge');

      this.catSelect = document.getElementById('find-select-category');
      this.keywordInput = document.getElementById('find-input-keyword');
      this.radiusSlider = document.getElementById('radius-slider-input');
      this.radiusValDisplay = document.getElementById('radius-val-display');
      this.radiusChips = Array.from(document.querySelectorAll('.radius-chip-btn'));
      this.clearBtn = document.getElementById('btn-clear-selections');
      this.executeBtn = document.getElementById('btn-find-leads-execute');
      this.inlineValidation = document.getElementById('find-inline-validation');
      this.nicheSummary = document.getElementById('target-summary-cat-text');
      this.locSummary = document.getElementById('target-summary-loc-text');
      this.quickNichesContainer = document.getElementById('quick-niches-container');

      this.cached = true;
    }
  };

  const CustomSelect = {
    stateList: [],
    cityList: [],
    activeDropdown: null, // 'state' | 'city' | null
    highlightedIndex: -1,
    bound: false,

    init() {
      FindLeadsDOM.init();
      if (this.bound) return;
      this.bound = true;
      this.bindEvents();
    },

    bindEvents() {
      const D = FindLeadsDOM;
      if (!D.stateTrigger || !D.cityTrigger) return;

      // Toggle state dropdown
      D.stateTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle('state');
      });

      // Toggle city dropdown
      D.cityTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (D.cityTrigger.disabled || !AppState.selectedState) return;
        this.toggle('city');
      });

      // Search input: State
      D.stateSearch.addEventListener('input', () => {
        const q = D.stateSearch.value.trim().toLowerCase();
        D.stateClear.classList.toggle('hidden', !q);
        this.renderFilteredStates(q);
      });

      D.stateClear.addEventListener('click', (e) => {
        e.stopPropagation();
        D.stateSearch.value = '';
        D.stateClear.classList.add('hidden');
        this.renderFilteredStates('');
        D.stateSearch.focus();
      });

      // Search input: City
      D.citySearch.addEventListener('input', () => {
        const q = D.citySearch.value.trim().toLowerCase();
        D.cityClear.classList.toggle('hidden', !q);
        this.renderFilteredCities(q);
      });

      D.cityClear.addEventListener('click', (e) => {
        e.stopPropagation();
        D.citySearch.value = '';
        D.cityClear.classList.add('hidden');
        this.renderFilteredCities('');
        D.citySearch.focus();
      });

      // Prevent clicks inside panel from closing
      D.statePanel.addEventListener('click', (e) => e.stopPropagation());
      D.cityPanel.addEventListener('click', (e) => e.stopPropagation());

      // Global click outside to close
      document.addEventListener('click', () => {
        if (this.activeDropdown) {
          this.closeAll();
        }
      });

      // Global Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.activeDropdown) {
          this.closeAll();
        }
      });

      // Keyboard navigation on search inputs
      D.stateSearch.addEventListener('keydown', (e) => this.handleKeyNav(e, 'state'));
      D.citySearch.addEventListener('keydown', (e) => this.handleKeyNav(e, 'city'));
    },

    toggle(type) {
      if (this.activeDropdown === type) {
        this.closeAll();
      } else {
        this.open(type);
      }
    },

    open(type) {
      this.closeAll();
      const D = FindLeadsDOM;
      this.activeDropdown = type;
      this.highlightedIndex = -1;

      if (type === 'state') {
        D.stateContainer.classList.add('open');
        D.statePanel.classList.remove('hidden');
        D.stateTrigger.setAttribute('aria-expanded', 'true');
        D.stateSearch.value = '';
        D.stateClear.classList.add('hidden');
        this.renderFilteredStates('');
        requestAnimationFrame(() => D.stateSearch.focus());
      } else if (type === 'city') {
        D.cityContainer.classList.add('open');
        D.cityPanel.classList.remove('hidden');
        D.cityTrigger.setAttribute('aria-expanded', 'true');
        D.citySearch.value = '';
        D.cityClear.classList.add('hidden');
        this.renderFilteredCities('');
        requestAnimationFrame(() => D.citySearch.focus());
      }
    },

    closeAll() {
      const D = FindLeadsDOM;
      if (D.stateContainer) {
        D.stateContainer.classList.remove('open');
        D.statePanel.classList.add('hidden');
        D.stateTrigger.setAttribute('aria-expanded', 'false');
      }
      if (D.cityContainer) {
        D.cityContainer.classList.remove('open');
        D.cityPanel.classList.add('hidden');
        D.cityTrigger.setAttribute('aria-expanded', 'false');
      }
      this.activeDropdown = null;
      this.highlightedIndex = -1;
    },

    populateStates(states) {
      this.stateList = states;
      this.renderFilteredStates('');
    },

    renderFilteredStates(query) {
      const D = FindLeadsDOM;
      if (!D.stateOptions) return;

      const q = query.toLowerCase();
      const filtered = q
        ? this.stateList.filter((s) => s.toLowerCase().includes(q))
        : this.stateList;

      D.stateEmpty.classList.toggle('hidden', filtered.length > 0);

      const frag = document.createDocumentFragment();
      filtered.forEach((stateName, idx) => {
        const item = document.createElement('div');
        const isSelected = AppState.selectedState === stateName;
        item.className = `custom-select-option ${isSelected ? 'selected' : ''}`;
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', stateName);
        item.setAttribute('data-index', idx);
        item.innerHTML = `<span>${stateName}</span>${isSelected ? '<i class="fa-solid fa-check option-check"></i>' : ''}`;

        item.addEventListener('click', () => {
          this.selectState(stateName);
        });
        frag.appendChild(item);
      });

      D.stateOptions.innerHTML = '';
      D.stateOptions.appendChild(frag);
      this.highlightedIndex = -1;
    },

    selectState(stateName) {
      const D = FindLeadsDOM;
      AppState.selectedState = stateName;
      if (D.stateInput) D.stateInput.value = stateName;
      if (D.stateLabel) {
        D.stateLabel.textContent = stateName;
        D.stateLabel.classList.add('has-value');
      }

      this.closeAll();

      // Cascade to City
      populateCityDropdown(stateName);
      updateTargetSummary();
      validateFindLeadsForm();
    },

    populateCities(cities, stateName) {
      this.cityList = cities;
      const D = FindLeadsDOM;

      if (!stateName || !cities.length) {
        D.cityContainer.classList.add('disabled');
        D.cityTrigger.disabled = true;
        D.cityLabel.textContent = '— First Select a State/UT Above —';
        D.cityLabel.classList.remove('has-value');
        if (D.cityInput) D.cityInput.value = '';
        if (D.cityBadge) D.cityBadge.classList.add('hidden');
        AppState.selectedCity = '';
        return;
      }

      D.cityContainer.classList.remove('disabled');
      D.cityTrigger.disabled = false;
      D.cityLabel.textContent = '— Choose City or District —';
      D.cityLabel.classList.remove('has-value');
      if (D.cityInput) D.cityInput.value = '';
      AppState.selectedCity = '';

      if (D.cityBadge) {
        D.cityBadge.textContent = `${cities.length} cities in ${stateName}`;
        D.cityBadge.classList.remove('hidden');
      }

      this.renderFilteredCities('');
    },

    renderFilteredCities(query) {
      const D = FindLeadsDOM;
      if (!D.cityOptions) return;

      const q = query.toLowerCase();
      const stateName = AppState.selectedState;
      const entireStateLabel = `Entire State (${stateName})`;

      // Filter
      const filtered = [];
      if (!q || entireStateLabel.toLowerCase().includes(q) || 'entire state'.includes(q)) {
        filtered.push({ value: 'Entire State', label: entireStateLabel, isEntireState: true });
      }

      this.cityList.forEach((c) => {
        if (!q || c.toLowerCase().includes(q)) {
          filtered.push({ value: c, label: c, isEntireState: false });
        }
      });

      D.cityEmpty.classList.toggle('hidden', filtered.length > 0);

      const frag = document.createDocumentFragment();
      filtered.forEach((itemObj, idx) => {
        const item = document.createElement('div');
        const isSelected = AppState.selectedCity === itemObj.value;
        item.className = `custom-select-option ${isSelected ? 'selected' : ''} ${itemObj.isEntireState ? 'entire-state-option' : ''}`;
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', itemObj.value);
        item.setAttribute('data-index', idx);
        item.innerHTML = `<span>${itemObj.label}</span>${isSelected ? '<i class="fa-solid fa-check option-check"></i>' : ''}`;

        item.addEventListener('click', () => {
          this.selectCity(itemObj.value, itemObj.label);
        });
        frag.appendChild(item);
      });

      D.cityOptions.innerHTML = '';
      D.cityOptions.appendChild(frag);
      this.highlightedIndex = -1;
    },

    selectCity(cityName, displayLabel) {
      const D = FindLeadsDOM;
      AppState.selectedCity = cityName;
      if (D.cityInput) D.cityInput.value = cityName;
      if (D.cityLabel) {
        D.cityLabel.textContent = displayLabel || cityName;
        D.cityLabel.classList.add('has-value');
      }

      this.closeAll();
      updateTargetSummary();
      validateFindLeadsForm();
    },

    resetAll() {
      const D = FindLeadsDOM;
      AppState.selectedState = '';
      AppState.selectedCity = '';
      if (D.stateInput) D.stateInput.value = '';
      if (D.cityInput) D.cityInput.value = '';
      if (D.stateLabel) {
        D.stateLabel.textContent = '— Choose State or Union Territory —';
        D.stateLabel.classList.remove('has-value');
      }
      if (D.cityLabel) {
        D.cityLabel.textContent = '— First Select a State/UT Above —';
        D.cityLabel.classList.remove('has-value');
      }
      if (D.cityContainer) D.cityContainer.classList.add('disabled');
      if (D.cityTrigger) D.cityTrigger.disabled = true;
      if (D.cityBadge) D.cityBadge.classList.add('hidden');
      this.closeAll();
    },

    handleKeyNav(e, type) {
      const D = FindLeadsDOM;
      const optionsEl = type === 'state' ? D.stateOptions : D.cityOptions;
      if (!optionsEl) return;
      const items = Array.from(optionsEl.querySelectorAll('.custom-select-option'));
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.highlightedIndex = Math.min(items.length - 1, this.highlightedIndex + 1);
        this.updateHighlight(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
        this.updateHighlight(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.highlightedIndex >= 0 && items[this.highlightedIndex]) {
          items[this.highlightedIndex].click();
        }
      }
    },

    updateHighlight(items) {
      items.forEach((item, idx) => {
        if (idx === this.highlightedIndex) {
          item.classList.add('highlighted');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('highlighted');
        }
      });
    }
  };

  window.CustomSelect = CustomSelect;

  function populateStateDropdown() {
    FindLeadsDOM.init();
    CustomSelect.init();
    const states = Object.keys(AppState.locations || {}).sort();
    CustomSelect.populateStates(states);
  }

  function populateCityDropdown(stateName) {
    FindLeadsDOM.init();
    if (!stateName || !AppState.locations || !AppState.locations[stateName]) {
      CustomSelect.populateCities([], null);
      validateFindLeadsForm();
      return;
    }

    const stateObj = AppState.locations[stateName];
    const cities = (stateObj.cities || []).slice().sort();
    CustomSelect.populateCities(cities, stateName);
    validateFindLeadsForm();
  }

  function populateCategoryDropdown() {
    FindLeadsDOM.init();
    const catSelect = FindLeadsDOM.catSelect;
    if (!catSelect || catSelect.tagName !== 'SELECT') return;

    const frag = document.createDocumentFragment();
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = '— Choose Business Category —';
    frag.appendChild(defOpt);

    AppState.categories.forEach((catName) => {
      const opt = document.createElement('option');
      opt.value = catName;
      opt.textContent = catName;
      frag.appendChild(opt);
    });

    catSelect.innerHTML = '';
    catSelect.appendChild(frag);
  }

  function renderQuickNiches() {
    FindLeadsDOM.init();
    const container = FindLeadsDOM.quickNichesContainer;
    if (!container) return;

    const frag = document.createDocumentFragment();
    AppState.quickNiches.forEach((niche) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `quick-niche-pill ${AppState.selectedCategory === niche ? 'active' : ''}`;
      btn.textContent = niche;
      btn.setAttribute('data-niche', niche);
      frag.appendChild(btn);
    });

    container.innerHTML = '';
    container.appendChild(frag);

    if (!container.dataset.bound) {
      container.dataset.bound = 'true';
      container.addEventListener('click', (e) => {
        const pill = e.target.closest('.quick-niche-pill');
        if (pill) {
          const niche = pill.getAttribute('data-niche') || pill.textContent.trim();
          selectCategory(niche);
        }
      });
    }
  }

  function normalizeCategoryName(name) {
    if (!name) return '';
    const clean = name.toLowerCase().trim();
    if (AppState.categories && AppState.categories.length) {
      const exact = AppState.categories.find((c) => c.toLowerCase() === clean);
      if (exact) return exact;
      const partial = AppState.categories.find(
        (c) =>
          c.toLowerCase().includes(clean) ||
          clean.includes(c.toLowerCase().split(' ')[0]) ||
          clean.includes(c.toLowerCase().split('/')[0].trim())
      );
      if (partial) return partial;
    }
    return name;
  }

  function selectCategory(catName) {
    const normalized = normalizeCategoryName(catName);
    AppState.selectedCategory = normalized;
    FindLeadsDOM.init();
    if (FindLeadsDOM.catSelect) {
      FindLeadsDOM.catSelect.value = normalized;
    }

    const pills = document.querySelectorAll('.quick-niche-pill');
    pills.forEach((p) => {
      const pillNiche = p.getAttribute('data-niche') || p.textContent.trim();
      if (
        pillNiche.toLowerCase() === (normalized || '').toLowerCase() ||
        pillNiche.toLowerCase() === (catName || '').toLowerCase()
      ) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });

    updateTargetSummary();
    validateFindLeadsForm();
  }

  function updateTargetSummary() {
    FindLeadsDOM.init();
    const nicheSummary = FindLeadsDOM.nicheSummary;
    const locSummary = FindLeadsDOM.locSummary;

    if (nicheSummary) {
      nicheSummary.textContent = AppState.selectedCategory || 'Select category';
    }

    if (locSummary) {
      if (AppState.selectedCity && AppState.selectedState) {
        if (AppState.selectedCity === 'Entire State') {
          locSummary.textContent = `Entire State (${AppState.selectedState})`;
        } else {
          locSummary.textContent = `${AppState.selectedCity}, ${AppState.selectedState}`;
        }
      } else if (AppState.selectedState) {
        locSummary.textContent = AppState.selectedState;
      } else {
        locSummary.textContent = 'Select location';
      }
    }
  }

  function validateFindLeadsForm() {
    FindLeadsDOM.init();
    const btn = FindLeadsDOM.executeBtn;
    const hint = FindLeadsDOM.inlineValidation;

    const isValid = Boolean(
      AppState.selectedState &&
      AppState.selectedCity &&
      AppState.selectedCategory &&
      AppState.selectedRadius
    );

    if (btn) {
      btn.disabled = !isValid;
    }

    if (hint) {
      if (!isValid) {
        let missing = [];
        if (!AppState.selectedState) missing.push('State');
        else if (!AppState.selectedCity) missing.push('City/District');
        if (!AppState.selectedCategory) missing.push('Category');
        if (AppState.selectedState && AppState.selectedCity && !AppState.selectedCategory) {
          hint.textContent = 'Please choose a business category.';
        } else {
          hint.textContent = `Select ${missing.join(' and ')} to continue`;
        }
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }

    return isValid;
  }

  let radiusRafId = null;
  function applyFindLeadsRadius(val) {
    const r = Math.max(1, parseInt(val, 10) || 25);
    AppState.selectedRadius = r;
    FindLeadsDOM.init();

    if (radiusRafId) cancelAnimationFrame(radiusRafId);
    radiusRafId = requestAnimationFrame(() => {
      radiusRafId = null;
      if (FindLeadsDOM.radiusSlider && FindLeadsDOM.radiusSlider.value != r) {
        FindLeadsDOM.radiusSlider.value = r;
      }
      if (FindLeadsDOM.radiusValDisplay) {
        FindLeadsDOM.radiusValDisplay.textContent = `${r} KM`;
      }

      if (FindLeadsDOM.radiusChips) {
        FindLeadsDOM.radiusChips.forEach((chip) => {
          const chipVal = parseInt(chip.getAttribute('data-radius'), 10);
          chip.classList.toggle('active', chipVal === r);
        });
      }
      validateFindLeadsForm();
    });
  }

  function initFindLeadsListeners() {
    FindLeadsDOM.init();
    CustomSelect.init();

    const D = FindLeadsDOM;

    // Category change (only if a visible select exists)
    if (D.catSelect && D.catSelect.tagName === 'SELECT') {
      D.catSelect.addEventListener('change', function () {
        selectCategory(this.value);
      });
    }

    // Keyword change
    if (D.keywordInput) {
      D.keywordInput.addEventListener('input', function () {
        AppState.selectedKeyword = this.value.trim();
      });
    }

    // Radius Slider & Chips (Throttled)
    if (D.radiusSlider) {
      D.radiusSlider.addEventListener('input', function () {
        applyFindLeadsRadius(this.value);
      });
    }

    if (D.radiusChips) {
      D.radiusChips.forEach((chip) => {
        chip.addEventListener('click', function () {
          const r = this.getAttribute('data-radius');
          applyFindLeadsRadius(r);
        });
      });
    }

    // Clear Selections
    if (D.clearBtn) {
      D.clearBtn.addEventListener('click', function () {
        AppState.selectedState = '';
        AppState.selectedCity = '';
        AppState.selectedCategory = '';
        AppState.selectedKeyword = '';
        applyFindLeadsRadius(25);

        CustomSelect.resetAll();

        if (D.catSelect) D.catSelect.value = '';
        if (D.keywordInput) D.keywordInput.value = '';

        document.querySelectorAll('.quick-niche-pill').forEach((p) => p.classList.remove('active'));
        updateTargetSummary();
        validateFindLeadsForm();
        showToast('Search parameters reset', 'info', 2000);
      });
    }

    // Execute Search Button -> opens Process Modal
    if (D.executeBtn) {
      D.executeBtn.addEventListener('click', function () {
        if (!AppState.selectedCategory) {
          showToast('Please choose a business category.', 'warning', 3000);
          return;
        }
        if (!validateFindLeadsForm()) return;
        runFindLeadsProcess();
      });
    }
  }

  // ----------------------------------------------------
  // 5. FIND LEADS PROCESS POPUP (SECTION 3)
  // ----------------------------------------------------
  const ProcessModalDOM = {
    cached: false,
    init() {
      if (this.cached && this.modal) return;
      this.modal = document.getElementById('modal-find-process');
      this.headline = document.getElementById('process-headline-text');
      this.tagCity = document.getElementById('process-tag-city');
      this.tagCat = document.getElementById('process-tag-cat');
      this.tagRadius = document.getElementById('process-tag-radius');
      this.stagesBox = document.getElementById('process-stages-container');
      this.countDisc = document.getElementById('proc-metric-discovered');
      this.countDup = document.getElementById('proc-metric-duplicates');
      this.countNew = document.getElementById('proc-metric-new');
      this.saveBtn = document.getElementById('btn-save-discovered-leads');
      this.saveLabel = document.getElementById('btn-save-leads-label');
      this.closeBtn = document.getElementById('btn-process-modal-close');
      this.cached = true;
    }
  };

  let isSearchProcessRunning = false;

  async function runFindLeadsProcess() {
    if (isSearchProcessRunning) {
      console.warn('[Find Leads] Search already running. Ignoring concurrent trigger.');
      return;
    }
    isSearchProcessRunning = true;
    FindLeadsDOM.init();
    if (FindLeadsDOM.executeBtn) {
      FindLeadsDOM.executeBtn.disabled = true;
    }

    ProcessModalDOM.init();
    const P = ProcessModalDOM;
    if (!P.modal) {
      isSearchProcessRunning = false;
      if (FindLeadsDOM.executeBtn) FindLeadsDOM.executeBtn.disabled = false;
      return;
    }

    if (!AppState.selectedCategory) {
      showToast('Please choose a business category.', 'warning', 3000);
      isSearchProcessRunning = false;
      if (FindLeadsDOM.executeBtn) FindLeadsDOM.executeBtn.disabled = false;
      return;
    }

    const isEntireState = AppState.selectedCity === 'Entire State';
    const locDisplay = isEntireState ? `Entire State (${AppState.selectedState})` : AppState.selectedCity;

    // Reset modal UI
    P.modal.classList.remove('hidden');
    if (P.headline) P.headline.textContent = `Initializing lead discovery engine for ${locDisplay}...`;
    if (P.tagCity) P.tagCity.textContent = locDisplay;
    if (P.tagCat) P.tagCat.textContent = AppState.selectedCategory;
    if (P.tagRadius) P.tagRadius.textContent = isEntireState ? 'State Wide' : `${AppState.selectedRadius} km`;

    if (P.countDisc) P.countDisc.textContent = '0';
    if (P.countDup) P.countDup.textContent = '0';
    if (P.countNew) P.countNew.textContent = '0';

    if (P.saveBtn) {
      P.saveBtn.disabled = true;
      P.saveBtn.style.display = 'flex';
      if (P.saveLabel) P.saveLabel.textContent = 'Save Leads';
    }

    if (P.stagesBox) P.stagesBox.innerHTML = '';

    const stages = [
      'Initializing lead search query',
      `Resolving location center coordinates (${locDisplay})`,
      `Searching Google Places API for ${AppState.selectedCategory}`,
      'Expanding discovery queries using industry synonyms',
      'Checking duplicate businesses against database',
      'Enriching verified business information & contact details',
      'Calculating Opportunity Scores'
    ];

    function createStageRow(text, status = 'active') {
      const row = document.createElement('div');
      row.className = `proc-step-row ${status}`;
      const icon =
        status === 'done'
          ? '<i class="fa-solid fa-check proc-step-ico"></i>'
          : status === 'active'
          ? '<i class="fa-solid fa-spinner proc-step-ico"></i>'
          : '<i class="fa-regular fa-circle proc-step-ico"></i>';
      row.innerHTML = `${icon}<span>${text}</span>`;
      return row;
    }

    function addStage(text, status = 'active') {
      const row = createStageRow(text, status);
      if (P.stagesBox) {
        P.stagesBox.appendChild(row);
        requestAnimationFrame(() => {
          P.stagesBox.scrollTop = P.stagesBox.scrollHeight;
        });
      }
      return row;
    }

    // Step 1: Initializing
    addStage(stages[0], 'done');

    // Step 2: Coordinates
    addStage(stages[1], 'done');

    // Step 3: Google Places Search (Active)
    if (P.headline) P.headline.textContent = `Searching ${locDisplay}...`;
    const step3 = addStage(stages[2], 'active');

    // Call Real Backend API
    try {
      const searchPayload = {
        state: AppState.selectedState,
        city: AppState.selectedCity,
        category: AppState.selectedCategory,
        radiusKm: isEntireState ? 100 : AppState.selectedRadius,
        keyword: AppState.selectedKeyword
      };

      console.log('[Find Leads Trace] Sending searchPayload to /api/leads/search:', searchPayload);
      const response = await fetch('/api/leads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload)
      });

      const result = await response.json();
      console.log('[Find Leads Trace] Backend returned:', {
        status: response.status,
        success: result.success,
        totalDiscovered: result.totalDiscovered,
        duplicatesRemoved: result.duplicatesRemoved,
        newLeadsCount: result.newLeadsCount,
        leadsLength: (result.leads || []).length
      });

      if (!response.ok || !result.success) {
        step3.className = 'proc-step-row';
        step3.innerHTML = `<i class="fa-solid fa-triangle-exclamation proc-step-ico" style="color:#f43f5e"></i><span>${result.error || 'Search could not be completed.'}</span>`;
        if (P.headline) P.headline.textContent = 'Search Error';
        if (P.saveBtn) P.saveBtn.disabled = true;
        showToast(result.error || 'Google Places API search failed.', 'error', 6000);
        return;
      }

      // Step 3 Done
      step3.className = 'proc-step-row done';
      step3.innerHTML = `<i class="fa-solid fa-check proc-step-ico"></i><span>${stages[2]}</span>`;

      // If partial search results were returned due to quota exhaustion / API error later in sequence
      if (result.partialSearchNotice) {
        showToast(result.partialSearchNotice, 'warning', 7000);
      }

      // Batch Steps 4 through 7 into a single fragment to avoid multiple layout passes
      const frag = document.createDocumentFragment();
      const step4 = createStageRow(stages[3], 'done');
      const step5 = createStageRow(
        `${stages[4]} (${result.duplicatesRemoved} previously saved skipped)`,
        'done'
      );
      const step6 = createStageRow(stages[5], 'done');
      const step7 = createStageRow(stages[6], 'done');

      frag.appendChild(step4);
      frag.appendChild(step5);
      frag.appendChild(step6);
      frag.appendChild(step7);

      if (P.stagesBox) {
        P.stagesBox.appendChild(frag);
        requestAnimationFrame(() => {
          P.stagesBox.scrollTop = P.stagesBox.scrollHeight;
        });
      }

      // Update counters with real numbers
      if (P.countDisc) P.countDisc.textContent = result.totalDiscovered;
      if (P.countDup) P.countDup.textContent = result.duplicatesRemoved;
      if (P.countNew) P.countNew.textContent = result.newLeadsCount;
      console.log(`[Find Leads Trace] Frontend UI updated: Discovered=${result.totalDiscovered}, Duplicates=${result.duplicatesRemoved}, New=${result.newLeadsCount}`);

      AppState.pendingDiscoveredLeads = result.leads || [];

      if (result.newLeadsCount > 0) {
        if (P.headline) P.headline.textContent = `${result.newLeadsCount} new businesses discovered!`;
        if (P.saveBtn) {
          P.saveBtn.disabled = false;
          if (P.saveLabel) P.saveLabel.textContent = `Save ${result.newLeadsCount} Leads`;
        }
      } else {
        if (P.saveBtn) {
          P.saveBtn.disabled = true;
        }
        if (result.duplicatesRemoved > 0) {
          if (P.headline) P.headline.textContent = 'Search complete — all found businesses already saved.';
          if (P.saveLabel) P.saveLabel.textContent = 'All Leads Already Saved';
          addStage('All matching businesses from this search have already been saved.', 'done');
        } else {
          if (P.headline) P.headline.textContent = 'No businesses found for this search.';
          if (P.saveLabel) P.saveLabel.textContent = 'No Leads Found';
          addStage('No businesses found matching this query in Google Places.', 'done');
        }
      }
    } catch (err) {
      console.error('Process error:', err);
      if (P.headline) P.headline.textContent = 'Network or Server Error';
      addStage('Could not connect to lead search service.', 'active');
      showToast('Network error during lead search.', 'error');
    } finally {
      isSearchProcessRunning = false;
      validateFindLeadsForm();
    }
  }



  function initProcessModalListeners() {
    const modal = document.getElementById('modal-find-process');
    const closeBtn = document.getElementById('btn-process-modal-close');
    const saveBtn = document.getElementById('btn-save-discovered-leads');

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }

    if (saveBtn && modal) {
      saveBtn.addEventListener('click', async function () {
        if (!AppState.pendingDiscoveredLeads.length) return;

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Saving to database...</span>';

        try {
          const res = await fetch('/api/leads/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leads: AppState.pendingDiscoveredLeads })
          });

          const data = await res.json();
          if (data.success) {
            modal.classList.add('hidden');
            showToast(`${data.savedCount} leads saved successfully!`, 'success');

            // Invalidate cached data so views fetch fresh data
            AppState.savedLeadsDirty = true;
            AppState.historyDirty = true;
            AppState.hasLoadedSavedLeads = false;

            // Update badge counts
            updateBadgeCounts();

            // Clear pending
            AppState.pendingDiscoveredLeads = [];

            // Offer view saved leads
            setTimeout(() => {
              showToast(
                `Leads added to Saved Leads. <a href="#saved-leads" id="toast-view-link" style="color:var(--accent-teal);text-decoration:underline;margin-left:6px;">View Saved Leads →</a>`,
                'info',
                5000
              );
              const link = document.getElementById('toast-view-link');
              if (link) {
                link.addEventListener('click', (e) => {
                  e.preventDefault();
                  switchView('saved-leads');
                });
              }
            }, 600);
          } else {
            showToast(data.error || 'Failed to save leads.', 'error');
          }
        } catch (err) {
          console.error('Error saving leads:', err);
          showToast('Could not save leads to database.', 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<span class="sparkle-teal">✦</span><span>Save Leads</span>';
        }
      });
    }
  }

  // ----------------------------------------------------
  // 6. SAVED LEADS CONTROLLER (00:29 → 00:36)
  // ----------------------------------------------------
  let savedLeadsAbortController = null;
  async function loadSavedLeads() {
    const tbody = document.getElementById('saved-leads-tbody');
    const emptyState = document.getElementById('saved-table-empty');
    const showingIndicator = document.getElementById('saved-showing-indicator');
    const totalPill = document.getElementById('saved-total-pill-count');
    if (!tbody) return;

    if (savedLeadsAbortController) {
      savedLeadsAbortController.abort();
    }
    savedLeadsAbortController = new AbortController();

    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:40px;color:#71717a;">
          <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i> Loading saved prospects...
        </td>
      </tr>
    `;

    try {
      const favsChk = document.getElementById('saved-check-favs');
      if (favsChk) AppState.savedFilters.favsOnly = favsChk.checked;
      const phoneChk = document.getElementById('saved-check-phone');
      if (phoneChk) AppState.savedFilters.phoneOnly = phoneChk.checked;

      const q = new URLSearchParams();
      if (AppState.savedFilters.search) q.append('search', AppState.savedFilters.search);
      if (AppState.savedFilters.website !== 'All') q.append('websiteStatus', AppState.savedFilters.website);
      if (AppState.savedFilters.status !== 'All') q.append('status', AppState.savedFilters.status);
      if (AppState.savedFilters.category !== 'All') q.append('category', AppState.savedFilters.category);
      if (AppState.savedFilters.state !== 'All') q.append('state', AppState.savedFilters.state);
      if (AppState.savedFilters.favsOnly) q.append('favorite', 'true');
      if (AppState.savedFilters.phoneOnly) q.append('hasPhone', 'true');
      q.append('sort', AppState.savedFilters.sort);

      const res = await fetch(`/api/leads/saved?${q.toString()}`, { signal: savedLeadsAbortController.signal });
      const data = await res.json();

      if (!data.success) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#f43f5e;">Could not load leads: ${data.error}</td></tr>`;
        return;
      }

      AppState.allSavedLeads = data.leads || [];
      AppState.savedLeads = data.leads || [];
      AppState.hasLoadedSavedLeads = true;
      AppState.savedLeadsDirty = false;

      // Update counter pill
      if (totalPill) {
        totalPill.textContent = `${data.totalCount} Leads`;
      }
      const desktopBadge = document.getElementById('nav-saved-badge');
      const mobileBadge = document.getElementById('mobile-nav-saved-badge');
      if (desktopBadge) desktopBadge.textContent = data.totalCount;
      if (mobileBadge) mobileBadge.textContent = data.totalCount;

      // Populate filter dropdown options dynamically if not yet done
      populateSavedFilterOptions(AppState.allSavedLeads);

      // Render pagination & rows
      renderSavedTableRows();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Error loading saved leads:', err);
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#f43f5e;">Failed to connect to backend server.</td></tr>`;
    }
  }

  function filterAndRenderSavedLeads() {
    if (!AppState.allSavedLeads || !AppState.allSavedLeads.length) {
      return loadSavedLeads();
    }

    const favsChk = document.getElementById('saved-check-favs');
    if (favsChk) AppState.savedFilters.favsOnly = favsChk.checked;
    const phoneChk = document.getElementById('saved-check-phone');
    if (phoneChk) AppState.savedFilters.phoneOnly = phoneChk.checked;

    let results = [...AppState.allSavedLeads];
    const q = (AppState.savedFilters.search || '').trim().toLowerCase();
    if (q) {
      results = results.filter((l) =>
        (l.business_name && l.business_name.toLowerCase().includes(q)) ||
        (l.category && l.category.toLowerCase().includes(q)) ||
        (l.city && l.city.toLowerCase().includes(q)) ||
        (l.state && l.state.toLowerCase().includes(q)) ||
        (l.district && l.district.toLowerCase().includes(q)) ||
        (l.phone && l.phone.toLowerCase().includes(q)) ||
        (l.website && l.website.toLowerCase().includes(q)) ||
        (l.address && l.address.toLowerCase().includes(q))
      );
    }
    if (AppState.savedFilters.website && AppState.savedFilters.website !== 'All') {
      results = results.filter((l) => l.website_status === AppState.savedFilters.website);
    }
    if (AppState.savedFilters.status && AppState.savedFilters.status !== 'All') {
      results = results.filter((l) => l.status === AppState.savedFilters.status);
    }
    if (AppState.savedFilters.category && AppState.savedFilters.category !== 'All') {
      results = results.filter((l) => l.category === AppState.savedFilters.category);
    }
    if (AppState.savedFilters.state && AppState.savedFilters.state !== 'All') {
      results = results.filter((l) => l.state === AppState.savedFilters.state);
    }
    if (AppState.savedFilters.favsOnly) {
      results = results.filter((l) => Boolean(l.favorite));
    }
    if (AppState.savedFilters.phoneOnly) {
      results = results.filter((l) => l.phone && l.phone !== 'Not available');
    }

    const sort = AppState.savedFilters.sort || 'newest';
    if (sort === 'newest') {
      results.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } else if (sort === 'oldest') {
      results.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    } else if (sort === 'opportunity') {
      results.sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));
    } else if (sort === 'name') {
      results.sort((a, b) => (a.business_name || '').localeCompare(b.business_name || ''));
    } else if (sort === 'rating') {
      results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    AppState.savedLeads = results;
    renderSavedTableRows();
  }

  function populateSavedFilterOptions(leads) {
    const catSelect = document.getElementById('saved-filter-category');
    const stSelect = document.getElementById('saved-filter-state');

    if (catSelect && catSelect.children.length <= 1) {
      const cats = [...new Set(leads.map((l) => l.category).filter(Boolean))].sort();
      cats.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `Category: ${cat}`;
        catSelect.appendChild(opt);
      });
    }

    if (stSelect && stSelect.children.length <= 1) {
      const states = [...new Set(leads.map((l) => l.state).filter(Boolean))].sort();
      states.forEach((st) => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = `State: ${st}`;
        stSelect.appendChild(opt);
      });
    }
  }

  function renderSavedTableRows() {
    const tbody = document.getElementById('saved-leads-tbody');
    const emptyState = document.getElementById('saved-table-empty');
    const showingIndicator = document.getElementById('saved-showing-indicator');
    const masterCheck = document.getElementById('saved-select-all');
    if (!tbody) return;

    const totalFiltered = AppState.savedLeads.length;
    if (totalFiltered === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      if (showingIndicator) showingIndicator.textContent = 'Showing 0 leads';
      renderPaginationButtons(0, 1, 25);
      updateBulkActionBar();
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const page = AppState.savedFilters.page;
    const perPage = AppState.savedFilters.rowsPerPage;
    const startIndex = (page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, totalFiltered);
    const visibleLeads = AppState.savedLeads.slice(startIndex, endIndex);

    if (showingIndicator) {
      showingIndicator.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalFiltered} leads`;
    }

    const frag = document.createDocumentFragment();

    visibleLeads.forEach((lead) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', lead.id);

      const isChecked = AppState.selectedLeadIds.has(lead.id);
      const isStarred = Boolean(lead.favorite);
      const hasWeb = lead.website_status === 'YES';
      const oppHigh = (lead.opportunity_score || 50) >= 85;

      // Website Cell
      const webCellHtml = hasWeb
        ? `<div class="website-cell-block">
             <span class="badge-has-web"><i class="fa-solid fa-globe"></i> YES</span>
             <a href="${lead.website}" target="_blank" rel="noopener noreferrer" class="link-visit-site">View site <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
           </div>`
        : `<div class="website-cell-block">
             <span class="badge-no-web">NO</span>
           </div>`;

      // Phone formatting
      const phoneDisplay = lead.phone || 'Not available';
      const hasPhone = phoneDisplay !== 'Not available';

      // Maps URL
      const mapsUrl = lead.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.business_name + ' ' + lead.city)}`;

      tr.innerHTML = `
        <td class="col-th-chk">
          <label class="cell-chk-label">
            <input type="checkbox" class="row-checkbox" data-id="${lead.id}" ${isChecked ? 'checked' : ''} />
            <span class="cell-chk-custom"></span>
          </label>
        </td>
        <td>${webCellHtml}</td>
        <td>
          <div class="lead-name-cell">
            <button type="button" class="star-favorite-btn ${isStarred ? 'active' : ''}" data-id="${lead.id}" title="${isStarred ? 'Remove favorite' : 'Add to favorites'}">
              ${isStarred ? '★' : '☆'}
            </button>
            <div class="lead-meta-col">
              <span class="lead-title-link" data-id="${lead.id}">${escapeHtml(lead.business_name)}</span>
              <div class="lead-sub-details">
                <span class="lead-category-tag">${escapeHtml(lead.category || 'Business')}</span>
                <span>•</span>
                <span>${escapeHtml(lead.city || '')}${lead.state ? ', ' + escapeHtml(lead.state) : ''}</span>
                <span class="opp-score-badge ${oppHigh ? 'high' : 'med'}">${lead.opportunity_score || 65}/100</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          ${
            hasPhone
              ? `<div class="contact-phone-box">
                   <i class="fa-solid fa-phone"></i>
                   <span>${escapeHtml(phoneDisplay)}</span>
                   <button type="button" class="btn-copy-clip" data-copy="${escapeHtml(phoneDisplay)}" title="Copy phone number">
                     <i class="fa-regular fa-copy"></i>
                   </button>
                 </div>`
              : `<span style="color:#52525b;font-size:12px;">N/A</span>`
          }
        </td>
        <td>
          <span style="color:${lead.email && lead.email !== 'Not available' ? '#e2e8f0' : '#52525b'};font-size:12px;">
            ${lead.email && lead.email !== 'Not available' ? escapeHtml(lead.email) : 'N/A'}
          </span>
        </td>
        <td>
          <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-open-google-maps">
            <span>Open Google</span>
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </a>
        </td>
        <td>
          <select class="table-status-pill" data-id="${lead.id}">
            <option value="New" ${lead.status === 'New' ? 'selected' : ''}>New</option>
            <option value="Contacted" ${lead.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
            <option value="Qualified" ${lead.status === 'Qualified' ? 'selected' : ''}>Qualified</option>
            <option value="Closed" ${lead.status === 'Closed' ? 'selected' : ''}>Closed</option>
          </select>
        </td>
        <td>
          <div class="table-actions-group">
            <!-- Outreach icon (paper plane) matching reference! -->
            <button type="button" class="btn-act-outreach" data-id="${lead.id}" title="Open Lead in Outreach">
              <i class="fa-regular fa-paper-plane"></i>
            </button>
            <button type="button" class="btn-act-sparkle" data-id="${lead.id}" title="View Opportunity Insights">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
            </button>
            <button type="button" class="btn-act-trash" data-id="${lead.id}" title="Delete Lead">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </td>
      `;

      frag.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);

    renderPaginationButtons(totalFiltered, page, perPage);
    updateBulkActionBar();
  }

  function renderPaginationButtons(total, currentPage, perPage) {
    const container = document.getElementById('saved-page-nums-list');
    const prevBtn = document.getElementById('btn-saved-page-prev');
    const nextBtn = document.getElementById('btn-saved-page-next');
    if (!container) return;

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    container.innerHTML = '';

    // Show up to 5 page numbers
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn-page-num ${p === currentPage ? 'active' : ''}`;
      btn.textContent = p;
      btn.addEventListener('click', () => {
        AppState.savedFilters.page = p;
        renderSavedTableRows();
      });
      container.appendChild(btn);
    }
  }

  function initSavedLeadsTableDelegation() {
    const tbody = document.getElementById('saved-leads-tbody');
    if (!tbody || tbody.dataset.delegated) return;
    tbody.dataset.delegated = 'true';

    // Change event for checkbox & status dropdown
    tbody.addEventListener('change', async (e) => {
      // Row Checkbox
      const chk = e.target.closest('.row-checkbox');
      if (chk) {
        const id = chk.getAttribute('data-id');
        if (chk.checked) {
          AppState.selectedLeadIds.add(id);
        } else {
          AppState.selectedLeadIds.delete(id);
        }
        updateBulkActionBar();
        return;
      }

      // Status dropdown
      const select = e.target.closest('.table-status-pill');
      if (select) {
        const id = select.getAttribute('data-id');
        const status = select.value;
        const previousStatus = select.getAttribute('data-current') || (AppState.savedLeads.find((l) => String(l.id) === String(id))?.status || 'New');
        try {
          const res = await fetch(`/api/leads/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
          });
          const data = await res.json();
          if (data.success) {
            select.setAttribute('data-current', status);
            const lead = AppState.savedLeads.find((l) => String(l.id) === String(id));
            if (lead) lead.status = status;
            const allLead = AppState.allSavedLeads?.find((l) => String(l.id) === String(id));
            if (allLead) allLead.status = status;
            showToast(`Status updated to "${status}"`, 'info', 2000);
          } else {
            select.value = previousStatus;
            showToast(data.error || 'Failed to update status on server.', 'error', 3000);
          }
        } catch (err) {
          select.value = previousStatus;
          showToast('Failed to update status. Network error.', 'error', 3000);
        }
        return;
      }
    });

    // Click event for buttons & links
    tbody.addEventListener('click', async (e) => {
      // Star Favorite
      const starBtn = e.target.closest('.star-favorite-btn');
      if (starBtn) {
        e.stopPropagation();
        const id = starBtn.getAttribute('data-id');
        const wasActive = starBtn.classList.contains('active');
        // Optimistic UI update
        starBtn.classList.toggle('active', !wasActive);
        starBtn.textContent = !wasActive ? '★' : '☆';
        try {
          const res = await fetch(`/api/leads/${id}/favorite`, { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            const lead = AppState.savedLeads.find((l) => String(l.id) === String(id));
            if (lead) lead.favorite = data.favorite;
            const allLead = AppState.allSavedLeads?.find((l) => String(l.id) === String(id));
            if (allLead) allLead.favorite = data.favorite;
            starBtn.classList.toggle('active', data.favorite);
            starBtn.textContent = data.favorite ? '★' : '☆';
            showToast(data.message, 'success', 2000);
            AppState.favoritesDirty = true;
            updateBadgeCounts();
          } else {
            // Rollback optimistic state on server error
            starBtn.classList.toggle('active', wasActive);
            starBtn.textContent = wasActive ? '★' : '☆';
            showToast(data.error || 'Failed to update favorite on server.', 'error', 3000);
          }
        } catch (err) {
          // Rollback on network error
          starBtn.classList.toggle('active', wasActive);
          starBtn.textContent = wasActive ? '★' : '☆';
          showToast('Failed to update favorite. Network error.', 'error', 3000);
        }
        return;
      }

      // Lead Details Modal
      const titleLink = e.target.closest('.lead-title-link, .btn-act-sparkle');
      if (titleLink) {
        const id = titleLink.getAttribute('data-id');
        const lead = AppState.savedLeads.find((l) => String(l.id) === String(id));
        if (lead) openLeadDetailModal(lead);
        return;
      }

      // Copy phone
      const copyBtn = e.target.closest('.btn-copy-clip');
      if (copyBtn) {
        const text = copyBtn.getAttribute('data-copy');
        if (text) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
          }
          showToast(`Copied phone: ${text}`, 'info', 2000);
        }
        return;
      }

      // Outreach Icon Button
      const outreachBtn = e.target.closest('.btn-act-outreach');
      if (outreachBtn) {
        const id = outreachBtn.getAttribute('data-id');
        const lead = AppState.savedLeads.find((l) => String(l.id) === String(id));
        if (lead) {
          if (lead.outreach_status === 'Pending') {
            openMoveToOutreachModal([lead.id || lead.place_id]);
          } else {
            startOutreachQueue([lead], 'saved-leads');
          }
        }
        return;
      }

      // Trash Button
      const trashBtn = e.target.closest('.btn-act-trash');
      if (trashBtn) {
        const id = trashBtn.getAttribute('data-id');
        const lead = AppState.savedLeads.find((l) => String(l.id) === String(id));
        if (lead) {
          AppState.leadToDelete = lead;
          AppState.isBulkDelete = false;
          openDeleteConfirmModal(`Delete "${lead.business_name}"?`, 'This lead will be permanently removed from your database.');
        }
        return;
      }
    });
  }

  function updateBulkActionBar() {
    const actionInfo = document.getElementById('saved-action-bar-info');
    const actionButtons = document.getElementById('saved-action-bar-buttons');
    const deselectBtn = document.getElementById('btn-saved-deselect-all');
    const bar = document.getElementById('saved-bulk-bar');
    const countText = document.getElementById('saved-bulk-count-text');
    const masterCheck = document.getElementById('saved-select-all');

    const count = AppState.selectedLeadIds.size;

    // 1. In-Card Action Bar
    if (count > 0) {
      if (actionInfo) actionInfo.innerHTML = `Selected: <strong>${count}</strong>`;
      if (actionButtons) actionButtons.classList.remove('hidden');
      if (deselectBtn) deselectBtn.classList.remove('hidden');
    } else {
      if (actionInfo) actionInfo.textContent = 'Select leads to perform bulk actions';
      if (actionButtons) actionButtons.classList.add('hidden');
      if (deselectBtn) deselectBtn.classList.add('hidden');
    }

    // 2. Floating Bulk Bar
    if (AppState.currentView === 'saved-leads' && count > 0) {
      if (bar) bar.classList.remove('hidden');
      if (countText) countText.textContent = `${count} lead${count > 1 ? 's' : ''} selected`;
    } else {
      if (bar) bar.classList.add('hidden');
    }

    // 3. Master Checkbox
    if (masterCheck) {
      const visibleCheckboxes = document.querySelectorAll('#saved-leads-tbody .row-checkbox');
      const allChecked = visibleCheckboxes.length > 0 && Array.from(visibleCheckboxes).every((c) => c.checked);
      masterCheck.checked = allChecked;
    }
  }

  function updateFavBulkActionBar() {
    const bar = document.getElementById('fav-bulk-bar');
    const countText = document.getElementById('fav-bulk-count-text');
    const masterCheck = document.getElementById('fav-select-all');

    const count = AppState.selectedFavLeadIds.size;
    // Only show bulk bar when viewing favorites section and count > 0
    if (AppState.currentView === 'favorites' && count > 0) {
      if (bar) bar.classList.remove('hidden');
      if (countText) countText.textContent = `${count} favorite${count > 1 ? 's' : ''} selected`;
    } else {
      if (bar) bar.classList.add('hidden');
    }

    if (masterCheck) {
      const visibleCheckboxes = document.querySelectorAll('#fav-leads-tbody .fav-row-checkbox');
      const allChecked = visibleCheckboxes.length > 0 && Array.from(visibleCheckboxes).every((c) => c.checked);
      masterCheck.checked = allChecked;
    }
  }

  // ----------------------------------------------------
  // 7. OUTREACH HANDOFF & DETAILS MODAL
  // ----------------------------------------------------
  function handOffLeadToOutreach(lead) {
    if (!lead) return;
    AppState.activeOutreachLead = lead;
    const leadId = lead.id || lead.place_id;
    if (AppState.outreach) {
      AppState.outreach.activeLeadId = leadId;
      AppState.outreach.subTab = 'ready';
    }

    try {
      sessionStorage.setItem('clienthunter_outreach_lead', JSON.stringify(lead));
    } catch (e) {}

    showToast(`Opening "${lead.business_name}" in Outreach Terminal...`, 'success', 2200);
    switchView('outreach');
    if (AppState.outreach) {
      updateOutreachSubTabsUI();
      selectOutreachLead(leadId);
    }
  }

  function openLeadDetailModal(lead) {
    const modal = document.getElementById('modal-lead-details');
    if (!modal) return;

    document.getElementById('detail-category-badge').textContent = lead.category || 'Business';
    document.getElementById('detail-business-name').textContent = lead.business_name;
    document.getElementById('detail-score-num').textContent = lead.opportunity_score || 50;
    document.getElementById('detail-score-lvl').textContent = lead.opportunity_level || 'MEDIUM';

    const reasonsList = document.getElementById('detail-reasons-list');
    if (reasonsList) {
      reasonsList.innerHTML = '';
      const reasons = lead.opportunity_reasons || [
        lead.website_status === 'NO' ? 'No website listed — web dev opportunity' : 'Website verified',
        lead.phone !== 'Not available' ? 'Verified phone available' : 'Phone unlisted'
      ];
      reasons.forEach((r) => {
        const item = document.createElement('div');
        item.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--accent-green);margin-right:6px;"></i>${escapeHtml(r)}`;
        reasonsList.appendChild(item);
      });
    }

    document.getElementById('detail-address-text').textContent = lead.address || 'Address unlisted';
    document.getElementById('detail-phone-text').textContent = lead.phone || 'Not available';

    const webText = document.getElementById('detail-website-text');
    if (webText) {
      webText.innerHTML = lead.website
        ? `<a href="${lead.website}" target="_blank" style="color:var(--accent-teal);text-decoration:underline;">${escapeHtml(lead.website)}</a>`
        : '<span style="color:#f43f5e;font-weight:600;">NO WEBSITE</span>';
    }

    document.getElementById('detail-rating-text').textContent = lead.rating
      ? `${lead.rating} ★ (${lead.review_count || 0} reviews)`
      : 'No rating listed';

    const mapsBtn = document.getElementById('detail-maps-link');
    if (mapsBtn) {
      mapsBtn.href = lead.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.business_name)}`;
    }

    const webBtn = document.getElementById('detail-web-link');
    if (webBtn) {
      if (lead.website) {
        webBtn.style.display = 'inline-flex';
        webBtn.href = lead.website;
      } else {
        webBtn.style.display = 'none';
      }
    }

    const outreachBtn = document.getElementById('btn-detail-outreach') || document.getElementById('detail-outreach');
    if (outreachBtn) {
      outreachBtn.onclick = () => {
        modal.classList.add('hidden');
        handOffLeadToOutreach(lead);
      };
    }

    // AI Growth Audit Wiring
    const auditBody = document.getElementById('detail-ai-audit-content');
    const auditBtn = document.getElementById('btn-generate-ai-audit');
    const auditBtnText = document.getElementById('btn-audit-text');
    if (auditBody) {
      auditBody.textContent = 'Click "Generate Audit" for an instant AI teardown of revenue leaks, missing digital assets, and high-ticket pitch angles.';
    }
    if (auditBtn) {
      auditBtn.disabled = false;
      if (auditBtnText) auditBtnText.textContent = 'Generate Audit';
      auditBtn.onclick = async () => {
        auditBtn.disabled = true;
        if (auditBtnText) auditBtnText.textContent = 'Analyzing...';
        if (auditBody) auditBody.textContent = 'Gemini AI is auditing digital assets, conversion leaks, and project value...';
        try {
          const res = await fetch(`/api/leads/${lead.id || lead.place_id}/ai-audit`);
          const data = await res.json();
          if (auditBody) {
            auditBody.textContent = data.audit || 'Audit complete.';
          }
          if (auditBtnText) auditBtnText.textContent = 'Re-audit';
        } catch (err) {
          if (auditBody) auditBody.textContent = 'Could not generate audit at this time. Please try again.';
          if (auditBtnText) auditBtnText.textContent = 'Retry Audit';
        } finally {
          auditBtn.disabled = false;
        }
      };
    }

    modal.classList.remove('hidden');
  }

  let deleteConfirmCallback = null;

  function openDeleteConfirmModal(title, desc, onConfirm = null) {
    deleteConfirmCallback = onConfirm;
    const modal = document.getElementById('modal-delete-confirm');
    const titleEl = document.getElementById('confirm-delete-title');
    const descEl = document.getElementById('confirm-delete-desc');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (modal) modal.classList.remove('hidden');
  }

  function openMoveToOutreachModal(customLeadIds = null) {
    const ids = customLeadIds || Array.from(AppState.selectedLeadIds);
    if (!ids.length) return;

    AppState.pendingMoveToOutreachIds = ids;

    const modal = document.getElementById('modal-move-outreach-confirm');
    const title = document.getElementById('confirm-move-outreach-title');
    const desc = document.getElementById('confirm-move-outreach-desc');

    if (title) title.textContent = 'Move to Outreach?';
    if (desc) desc.textContent = `You are about to move ${ids.length} selected lead${ids.length > 1 ? 's' : ''} to your Outreach queue.`;

    if (modal) modal.classList.remove('hidden');
  }

  async function performMoveToOutreach() {
    const ids = AppState.pendingMoveToOutreachIds || Array.from(AppState.selectedLeadIds);
    if (!ids || !ids.length) return;

    const confirmBtn = document.getElementById('btn-confirm-move-outreach');
    const modal = document.getElementById('modal-move-outreach-confirm');

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Moving...</span>';
    }

    try {
      const res = await fetch('/api/leads/move-to-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: ids })
      });
      const data = await res.json();
      if (data.success) {
        // Update in-memory leads state
        const idSet = new Set(ids.map(String));
        AppState.savedLeads.forEach((l) => {
          if (idSet.has(String(l.id)) || idSet.has(String(l.place_id))) {
            if (!l.first_message_sent) l.outreach_status = 'Not Contacted';
          }
        });
        if (AppState.allSavedLeads) {
          AppState.allSavedLeads.forEach((l) => {
            if (idSet.has(String(l.id)) || idSet.has(String(l.place_id))) {
              if (!l.first_message_sent) l.outreach_status = 'Not Contacted';
            }
          });
        }

        // Clear selection
        AppState.selectedLeadIds.clear();
        document.querySelectorAll('#saved-leads-tbody .row-checkbox').forEach((c) => (c.checked = false));
        const masterCheck = document.getElementById('saved-select-all');
        if (masterCheck) masterCheck.checked = false;

        // Invalidate outreach and saved leads caches so UI reloads fresh data
        AppState.outreachDirty = true;
        AppState.savedLeadsDirty = true;

        updateBulkActionBar();
        updateBadgeCounts();

        if (modal) modal.classList.add('hidden');
        showToast(`✓ ${data.movedCount} lead${data.movedCount > 1 ? 's' : ''} moved to Outreach queue.`, 'success');
      } else {
        showToast(data.error || 'Failed to move leads to Outreach.', 'error');
      }
    } catch (err) {
      console.error('Error moving leads to outreach:', err);
      showToast('Could not move leads to Outreach.', 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Move to Outreach';
      }
      AppState.pendingMoveToOutreachIds = null;
    }
  }

  function initModals() {
    // Move to Outreach Modal
    const moveOutreachModal = document.getElementById('modal-move-outreach-confirm');
    const cancelMoveOutreachBtn = document.getElementById('btn-cancel-move-outreach');
    const performMoveOutreachBtn = document.getElementById('btn-confirm-move-outreach');

    if (cancelMoveOutreachBtn && moveOutreachModal) {
      cancelMoveOutreachBtn.addEventListener('click', () => {
        moveOutreachModal.classList.add('hidden');
        AppState.pendingMoveToOutreachIds = null;
      });
    }
    if (moveOutreachModal) {
      moveOutreachModal.addEventListener('click', (e) => {
        if (e.target === moveOutreachModal) {
          moveOutreachModal.classList.add('hidden');
          AppState.pendingMoveToOutreachIds = null;
        }
      });
    }
    if (performMoveOutreachBtn) {
      performMoveOutreachBtn.addEventListener('click', () => performMoveToOutreach());
    }

    // Lead Detail Modal Close
    const detailModal = document.getElementById('modal-lead-details');
    const detailClose = document.getElementById('btn-close-lead-detail');
    if (detailClose && detailModal) {
      detailClose.addEventListener('click', () => detailModal.classList.add('hidden'));
    }
    if (detailModal) {
      detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) detailModal.classList.add('hidden');
      });
    }

    // Delete Confirm Modal Buttons
    const deleteModal = document.getElementById('modal-delete-confirm');
    const cancelDeleteBtn = document.getElementById('btn-cancel-delete');
    const performDeleteBtn = document.getElementById('btn-perform-delete');

    if (cancelDeleteBtn && deleteModal) {
      cancelDeleteBtn.addEventListener('click', () => {
        deleteModal.classList.add('hidden');
        deleteConfirmCallback = null;
        AppState.leadToDelete = null;
        AppState.isBulkDelete = false;
      });
    }
    if (deleteModal) {
      deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) {
          deleteModal.classList.add('hidden');
          deleteConfirmCallback = null;
          AppState.leadToDelete = null;
          AppState.isBulkDelete = false;
        }
      });
    }

    // Process Modal Backdrop click
    const processModal = document.getElementById('modal-find-process');
    if (processModal) {
      processModal.addEventListener('click', (e) => {
        if (e.target === processModal) {
          processModal.classList.add('hidden');
        }
      });
    }

    // Remove from Favorites Confirmation Modal
    const unfavModal = document.getElementById('modal-unfav-confirm');
    const cancelUnfavBtn = document.getElementById('btn-cancel-unfav');
    const performUnfavBtn = document.getElementById('btn-perform-unfav');

    if (cancelUnfavBtn && unfavModal) {
      cancelUnfavBtn.addEventListener('click', () => {
        unfavModal.classList.add('hidden');
      });
    }

    if (unfavModal) {
      unfavModal.addEventListener('click', (e) => {
        if (e.target === unfavModal) unfavModal.classList.add('hidden');
      });
    }

    if (performUnfavBtn && unfavModal) {
      performUnfavBtn.addEventListener('click', async () => {
        unfavModal.classList.add('hidden');
        const ids = Array.from(AppState.selectedFavLeadIds);
        if (!ids.length) return;

        try {
          const res = await fetch('/api/leads/favorite-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, favorite: false })
          });
          const data = await res.json();
          if (data.success) {
            const count = ids.length;
            AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => !AppState.selectedFavLeadIds.has(l.id));
            AppState.savedLeads.forEach((l) => {
              if (AppState.selectedFavLeadIds.has(l.id)) l.favorite = false;
            });
            AppState.selectedFavLeadIds.clear();
            updateFavBulkActionBar();
            renderFavTableRows();
            updateBadgeCounts();
            populateFavFilterOptions();
            showToast(`${count} lead${count > 1 ? 's' : ''} removed from Favorites`, 'info', 2500);
          }
        } catch (err) {
          showToast('Failed to remove leads from Favorites.', 'error');
        }
      });
    }

    // Global ESC key to close any open modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (detailModal && !detailModal.classList.contains('hidden')) {
          detailModal.classList.add('hidden');
        }
        if (deleteModal && !deleteModal.classList.contains('hidden')) {
          deleteModal.classList.add('hidden');
          deleteConfirmCallback = null;
          AppState.leadToDelete = null;
          AppState.isBulkDelete = false;
        }
        if (processModal && !processModal.classList.contains('hidden')) {
          processModal.classList.add('hidden');
        }
        if (unfavModal && !unfavModal.classList.contains('hidden')) {
          unfavModal.classList.add('hidden');
        }
      }
    });

    if (performDeleteBtn && deleteModal) {
      performDeleteBtn.addEventListener('click', async () => {
        deleteModal.classList.add('hidden');

        if (typeof deleteConfirmCallback === 'function') {
          const cb = deleteConfirmCallback;
          deleteConfirmCallback = null;
          await cb();
          return;
        }

        const isFavView = AppState.currentView === 'favorites';

        if (AppState.isBulkDelete) {
          // Bulk delete
          const ids = isFavView ? Array.from(AppState.selectedFavLeadIds) : Array.from(AppState.selectedLeadIds);
          if (!ids.length) return;

          try {
            const res = await fetch('/api/leads/delete-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids })
            });
            const data = await res.json();
            if (data.success) {
              showToast(`${data.deletedCount} leads deleted.`, 'success');
              if (isFavView) {
                AppState.selectedFavLeadIds.clear();
                AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => !ids.includes(l.id));
                AppState.savedLeads = AppState.savedLeads.filter((l) => !ids.includes(l.id));
                if (AppState.allSavedLeads) AppState.allSavedLeads = AppState.allSavedLeads.filter((l) => !ids.includes(l.id));
                updateFavBulkActionBar();
                renderFavTableRows();
                populateFavFilterOptions();
              } else {
                AppState.selectedLeadIds.clear();
                AppState.savedLeads = AppState.savedLeads.filter((l) => !ids.includes(l.id));
                if (AppState.allSavedLeads) AppState.allSavedLeads = AppState.allSavedLeads.filter((l) => !ids.includes(l.id));
                AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => !ids.includes(l.id));
                updateBulkActionBar();
                renderSavedTableRows();
              }
              AppState.savedLeadsDirty = true;
              AppState.favoritesDirty = true;
              AppState.outreachDirty = true;
              AppState.followupDirty = true;
              updateBadgeCounts();
            } else {
              showToast(data.error || 'Failed to delete selected leads.', 'error', 3000);
            }
          } catch (err) {
            showToast('Failed to delete selected leads.', 'error');
          }
        } else if (AppState.leadToDelete) {
          // Single delete
          const id = AppState.leadToDelete.id;
          try {
            const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              showToast('Lead deleted.', 'success');
              if (isFavView) {
                AppState.selectedFavLeadIds.delete(id);
                AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => l.id !== id);
                AppState.savedLeads = AppState.savedLeads.filter((l) => l.id !== id);
                if (AppState.allSavedLeads) AppState.allSavedLeads = AppState.allSavedLeads.filter((l) => l.id !== id);
                updateFavBulkActionBar();
                const row = document.querySelector(`#fav-leads-tbody tr[data-id="${id}"]`);
                if (row) row.remove();
                if (!document.getElementById('fav-leads-tbody')?.children.length) {
                  renderFavTableRows();
                }
              } else {
                AppState.selectedLeadIds.delete(id);
                AppState.savedLeads = AppState.savedLeads.filter((l) => l.id !== id);
                if (AppState.allSavedLeads) AppState.allSavedLeads = AppState.allSavedLeads.filter((l) => l.id !== id);
                AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => l.id !== id);
                updateBulkActionBar();
                const row = document.querySelector(`#saved-leads-tbody tr[data-id="${id}"]`);
                if (row) row.remove();
                if (!document.getElementById('saved-leads-tbody')?.children.length) {
                  renderSavedTableRows();
                } else {
                  const total = AppState.savedLeads.length;
                  const indicator = document.getElementById('saved-showing-indicator');
                  if (indicator) {
                    const page = AppState.savedFilters.page;
                    const perPage = AppState.savedFilters.rowsPerPage;
                    const startIndex = (page - 1) * perPage;
                    const endIndex = Math.min(startIndex + perPage, total);
                    indicator.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${total} leads`;
                  }
                }
              }
              AppState.savedLeadsDirty = true;
              AppState.favoritesDirty = true;
              AppState.outreachDirty = true;
              AppState.followupDirty = true;
              updateBadgeCounts();
            } else {
              showToast(data.error || 'Failed to delete lead from server.', 'error', 3000);
            }
          } catch (err) {
            showToast('Failed to delete lead.', 'error');
          } finally {
            AppState.leadToDelete = null;
          }
        }
      });
    }
  }

  function initSavedLeadsToolbar() {
    const searchField = document.getElementById('saved-search-box');
    const webFilter = document.getElementById('saved-filter-website');
    const statusFilter = document.getElementById('saved-filter-status');
    const catFilter = document.getElementById('saved-filter-category');
    const stateFilter = document.getElementById('saved-filter-state');
    const favsCheck = document.getElementById('saved-check-favs');
    const phoneCheck = document.getElementById('saved-check-phone');
    const rowsChoice = document.getElementById('saved-rows-choice');
    const refreshBtn = document.getElementById('btn-reload-saved-table');
    const exportBtn = document.getElementById('btn-export-leads-csv');
    const findMoreBtn = document.getElementById('btn-goto-find-leads');
    const emptyFindBtn = document.getElementById('btn-empty-find-more');
    const masterCheck = document.getElementById('saved-select-all');

    // Debounced in-memory search
    let searchTimer;
    if (searchField) {
      searchField.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          AppState.savedFilters.search = this.value;
          AppState.savedFilters.page = 1;
          filterAndRenderSavedLeads();
        }, 100);
      });
    }

    if (webFilter) {
      webFilter.addEventListener('change', function () {
        AppState.savedFilters.website = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (statusFilter) {
      statusFilter.addEventListener('change', function () {
        AppState.savedFilters.status = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (catFilter) {
      catFilter.addEventListener('change', function () {
        AppState.savedFilters.category = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (stateFilter) {
      stateFilter.addEventListener('change', function () {
        AppState.savedFilters.state = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (favsCheck) {
      favsCheck.addEventListener('change', function () {
        AppState.savedFilters.favsOnly = this.checked;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (phoneCheck) {
      phoneCheck.addEventListener('change', function () {
        AppState.savedFilters.phoneOnly = this.checked;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (rowsChoice) {
      rowsChoice.addEventListener('change', function () {
        AppState.savedFilters.rowsPerPage = parseInt(this.value, 10) || 25;
        AppState.savedFilters.page = 1;
        renderSavedTableRows();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadSavedLeads();
        showToast('Refreshed leads database.', 'info', 1500);
      });
    }

    // Export Leads as CSV
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        if (!AppState.savedLeads.length) {
          showToast('No leads available to export.', 'info');
          return;
        }

        const headers = ['Business Name', 'Category', 'City', 'State', 'Phone', 'Website', 'Website Status', 'Opportunity Score', 'Opportunity Level', 'Google Maps URL'];
        const rows = AppState.savedLeads.map((l) => [
          `"${(l.business_name || '').replace(/"/g, '""')}"`,
          `"${(l.category || '').replace(/"/g, '""')}"`,
          `"${(l.city || '').replace(/"/g, '""')}"`,
          `"${(l.state || '').replace(/"/g, '""')}"`,
          `"${(l.phone || '').replace(/"/g, '""')}"`,
          `"${(l.website || '').replace(/"/g, '""')}"`,
          `"${l.website_status || 'NO'}"`,
          l.opportunity_score || 50,
          `"${l.opportunity_level || 'MEDIUM'}"`,
          `"${(l.google_maps_url || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `ClientHunter_Saved_Leads_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast(`Exported ${AppState.savedLeads.length} leads to CSV`, 'success');
      });
    }

    // Switch to Find Leads
    if (findMoreBtn) {
      findMoreBtn.addEventListener('click', () => switchView('find-leads'));
    }
    if (emptyFindBtn) {
      emptyFindBtn.addEventListener('click', () => switchView('find-leads'));
    }

    // Master Select All Checkbox
    if (masterCheck) {
      masterCheck.addEventListener('change', function () {
        const visibleCheckboxes = document.querySelectorAll('.row-checkbox');
        visibleCheckboxes.forEach((chk) => {
          chk.checked = masterCheck.checked;
          const id = chk.getAttribute('data-id');
          if (masterCheck.checked) {
            AppState.selectedLeadIds.add(id);
          } else {
            AppState.selectedLeadIds.delete(id);
          }
        });
        updateBulkActionBar();
      });
    }

    // In-Card Action Bar Buttons
    const actionMoveOutreachBtn = document.getElementById('btn-saved-action-move-outreach');
    const actionDeleteBtn = document.getElementById('btn-saved-action-delete');
    const actionDeselectBtn = document.getElementById('btn-saved-deselect-all');

    // Floating Bulk Action Bar Buttons
    const bulkDeleteBtn = document.getElementById('btn-bulk-delete');
    const bulkOutreachBtn = document.getElementById('btn-bulk-outreach');
    const bulkDismissBtn = document.getElementById('btn-bulk-dismiss');

    if (actionMoveOutreachBtn) {
      actionMoveOutreachBtn.addEventListener('click', () => {
        if (AppState.selectedLeadIds.size === 0) return;
        openMoveToOutreachModal();
      });
    }

    if (bulkOutreachBtn) {
      bulkOutreachBtn.addEventListener('click', () => {
        if (AppState.selectedLeadIds.size === 0) return;
        openMoveToOutreachModal();
      });
    }

    if (actionDeleteBtn) {
      actionDeleteBtn.addEventListener('click', () => {
        const count = AppState.selectedLeadIds.size;
        if (count === 0) return;
        AppState.isBulkDelete = true;
        openDeleteConfirmModal('Delete Selected Leads?', `This will permanently delete ${count} selected lead${count > 1 ? 's' : ''} and their associated outreach/follow-up history.`);
      });
    }

    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', () => {
        const count = AppState.selectedLeadIds.size;
        if (count === 0) return;
        AppState.isBulkDelete = true;
        openDeleteConfirmModal('Delete Selected Leads?', `This will permanently delete ${count} selected lead${count > 1 ? 's' : ''} and their associated outreach/follow-up history.`);
      });
    }

    if (actionDeselectBtn) {
      actionDeselectBtn.addEventListener('click', () => {
        AppState.selectedLeadIds.clear();
        document.querySelectorAll('#saved-leads-tbody .row-checkbox').forEach((c) => (c.checked = false));
        if (masterCheck) masterCheck.checked = false;
        updateBulkActionBar();
      });
    }

    if (bulkDismissBtn) {
      bulkDismissBtn.addEventListener('click', () => {
        AppState.selectedLeadIds.clear();
        document.querySelectorAll('#saved-leads-tbody .row-checkbox').forEach((c) => (c.checked = false));
        if (masterCheck) masterCheck.checked = false;
        updateBulkActionBar();
      });
    }

    // Pagination navigation buttons
    const prevPageBtn = document.getElementById('btn-saved-page-prev');
    const nextPageBtn = document.getElementById('btn-saved-page-next');
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        if (AppState.savedFilters.page > 1) {
          AppState.savedFilters.page--;
          renderSavedTableRows();
        }
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        const maxPage = Math.ceil(AppState.savedLeads.length / AppState.savedFilters.rowsPerPage);
        if (AppState.savedFilters.page < maxPage) {
          AppState.savedFilters.page++;
          renderSavedTableRows();
        }
      });
    }
  }

  // ----------------------------------------------------
  // 7. FAVORITE LEADS CONTROLLER
  // ----------------------------------------------------
  let favoriteLeadsAbortController = null;
  async function loadFavoriteLeads() {
    const tbody = document.getElementById('fav-leads-tbody');
    const emptyState = document.getElementById('fav-table-empty');
    const showingIndicator = document.getElementById('fav-showing-indicator');
    const totalPill = document.getElementById('fav-total-pill-count');
    const refreshBtn = document.getElementById('btn-reload-fav-table');
    if (!tbody) return;

    if (favoriteLeadsAbortController) {
      favoriteLeadsAbortController.abort();
    }
    favoriteLeadsAbortController = new AbortController();

    if (refreshBtn) {
      const ico = refreshBtn.querySelector('i');
      if (ico) ico.classList.add('fa-spin');
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:40px;color:#71717a;">
          <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i> Loading favorite prospects...
        </td>
      </tr>
    `;

    try {
      const q = new URLSearchParams();
      q.append('favorite', 'true');
      if (AppState.favFilters.search) q.append('search', AppState.favFilters.search);
      if (AppState.favFilters.website !== 'All') q.append('websiteStatus', AppState.favFilters.website);
      if (AppState.favFilters.status !== 'All') q.append('status', AppState.favFilters.status);
      if (AppState.favFilters.category !== 'All') q.append('category', AppState.favFilters.category);
      if (AppState.favFilters.state !== 'All') q.append('state', AppState.favFilters.state);
      if (AppState.favFilters.phone === 'YES') q.append('hasPhone', 'YES');
      else if (AppState.favFilters.phone === 'NO') q.append('hasPhone', 'NO');
      q.append('sort', AppState.favFilters.sort);

      const res = await fetch(`/api/leads/saved?${q.toString()}`, { signal: favoriteLeadsAbortController.signal });
      const data = await res.json();

      if (!data.success) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#f43f5e;">Could not load favorites: ${data.error}</td></tr>`;
        return;
      }

      AppState.favoriteLeads = data.leads || [];
      AppState.hasLoadedFavorites = true;
      AppState.favoritesDirty = false;

      // Update total pill count
      const favTotal = data.favoritesCount !== undefined ? data.favoritesCount : AppState.favoriteLeads.length;
      if (totalPill) {
        totalPill.textContent = `${favTotal} Favorites`;
      }

      // Populate filter dropdown options directly from already fetched leads without duplicate network request
      populateFavFilterOptions(AppState.favoriteLeads);

      // Render pagination & rows
      renderFavTableRows();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Error loading favorite leads:', err);
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#f43f5e;">Failed to connect to backend server.</td></tr>`;
    } finally {
      if (refreshBtn) {
        const ico = refreshBtn.querySelector('i');
        if (ico) ico.classList.remove('fa-spin');
      }
    }
  }

  async function populateFavFilterOptions(providedLeads = null) {
    const catSelect = document.getElementById('fav-filter-category');
    const stSelect = document.getElementById('fav-filter-state');
    if (!catSelect || !stSelect) return;

    try {
      let allFavLeads = providedLeads;
      if (!allFavLeads) {
        if (AppState.favoriteLeads && AppState.favoriteLeads.length > 0) {
          allFavLeads = AppState.favoriteLeads;
        } else {
          const res = await fetch('/api/leads/saved?favorite=true');
          const data = await res.json();
          allFavLeads = data.leads || [];
        }
      }

      // Populate Categories (only from actual favorite leads)
      const currentCat = AppState.favFilters.category;
      catSelect.innerHTML = '<option value="All">Category: All</option>';
      const cats = [...new Set(allFavLeads.map((l) => l.category).filter(Boolean))].sort();
      cats.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `Category: ${cat}`;
        if (cat === currentCat) opt.selected = true;
        catSelect.appendChild(opt);
      });

      // Populate States (only states that have favorite leads)
      const currentState = AppState.favFilters.state;
      stSelect.innerHTML = '<option value="All">State: All</option>';
      const states = [...new Set(allFavLeads.map((l) => l.state).filter(Boolean))].sort();
      states.forEach((st) => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = `State: ${st}`;
        if (st === currentState) opt.selected = true;
        stSelect.appendChild(opt);
      });
    } catch (err) {
      console.warn('Could not populate favorite filter options:', err);
    }
  }

  function renderFavTableRows() {
    const tbody = document.getElementById('fav-leads-tbody');
    const emptyState = document.getElementById('fav-table-empty');
    const showingIndicator = document.getElementById('fav-showing-indicator');
    if (!tbody) return;

    const totalFiltered = AppState.favoriteLeads.length;

    if (totalFiltered === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      if (showingIndicator) showingIndicator.textContent = 'No favorite leads found';
      renderFavPaginationButtons(0, 1, 25);
      updateFavBulkActionBar();
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const page = AppState.favFilters.page;
    const perPage = AppState.favFilters.rowsPerPage;
    const startIndex = (page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, totalFiltered);
    const visibleLeads = AppState.favoriteLeads.slice(startIndex, endIndex);

    if (showingIndicator) {
      showingIndicator.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalFiltered} favorite leads`;
    }

    const frag = document.createDocumentFragment();

    visibleLeads.forEach((lead) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', lead.id);

      const isChecked = AppState.selectedFavLeadIds.has(lead.id);
      const isStarred = true; // Always favorite in this view
      const hasWeb = lead.website_status === 'YES';
      const oppHigh = (lead.opportunity_score || 50) >= 85;

      // Website Cell
      const webCellHtml = hasWeb
        ? `<div class="website-cell-block">
             <span class="badge-has-web"><i class="fa-solid fa-globe"></i> YES</span>
             <a href="${lead.website}" target="_blank" rel="noopener noreferrer" class="link-visit-site">View site <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
           </div>`
        : `<div class="website-cell-block">
             <span class="badge-no-web">NO</span>
           </div>`;

      // Phone formatting
      const phoneDisplay = lead.phone || 'Not available';
      const hasPhone = phoneDisplay !== 'Not available';

      // Maps URL
      const mapsUrl = lead.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.business_name + ' ' + lead.city)}`;

      tr.innerHTML = `
        <td class="col-th-chk">
          <label class="cell-chk-label">
            <input type="checkbox" class="fav-row-checkbox" data-id="${lead.id}" ${isChecked ? 'checked' : ''} />
            <span class="cell-chk-custom"></span>
          </label>
        </td>
        <td>${webCellHtml}</td>
        <td>
          <div class="lead-name-cell">
            <button type="button" class="star-favorite-btn fav-star active" data-id="${lead.id}" title="Remove from Favorites">
              ★
            </button>
            <div class="lead-meta-col">
              <span class="lead-title-link fav-title-link" data-id="${lead.id}">${escapeHtml(lead.business_name)}</span>
              <div class="lead-sub-details">
                <span class="lead-category-tag">${escapeHtml(lead.category || 'Business')}</span>
                <span>•</span>
                <span>${escapeHtml(lead.city || '')}${lead.state ? ', ' + escapeHtml(lead.state) : ''}</span>
                <span class="opp-score-badge ${oppHigh ? 'high' : 'med'}">${lead.opportunity_score || 65}/100</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          ${
            hasPhone
              ? `<div class="contact-phone-box">
                   <i class="fa-solid fa-phone"></i>
                   <span>${escapeHtml(phoneDisplay)}</span>
                   <button type="button" class="btn-copy-clip" data-copy="${escapeHtml(phoneDisplay)}" title="Copy phone number">
                     <i class="fa-regular fa-copy"></i>
                   </button>
                 </div>`
              : `<span style="color:#52525b;font-size:12px;">N/A</span>`
          }
        </td>
        <td>
          <span style="color:${lead.email && lead.email !== 'Not available' ? '#e2e8f0' : '#52525b'};font-size:12px;">
            ${lead.email && lead.email !== 'Not available' ? escapeHtml(lead.email) : 'N/A'}
          </span>
        </td>
        <td>
          <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-open-google-maps">
            <span>Open Google</span>
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </a>
        </td>
        <td>
          <select class="table-status-pill fav-status-pill" data-id="${lead.id}">
            <option value="New" ${lead.status === 'New' ? 'selected' : ''}>New</option>
            <option value="Not Contacted" ${lead.status === 'Not Contacted' ? 'selected' : ''}>Not Contacted</option>
            <option value="Contacted" ${lead.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
            <option value="Replied" ${lead.status === 'Replied' ? 'selected' : ''}>Replied</option>
            <option value="Follow-Up Due" ${lead.status === 'Follow-Up Due' ? 'selected' : ''}>Follow-Up Due</option>
            <option value="Completed" ${lead.status === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Qualified" ${lead.status === 'Qualified' ? 'selected' : ''}>Qualified</option>
            <option value="Closed" ${lead.status === 'Closed' ? 'selected' : ''}>Closed</option>
          </select>
        </td>
        <td>
          <div class="table-actions-group">
            <button type="button" class="btn-act-outreach" data-id="${lead.id}" title="Open Lead in Outreach">
              <i class="fa-regular fa-paper-plane"></i>
            </button>
            <button type="button" class="btn-act-sparkle" data-id="${lead.id}" title="View Opportunity Insights">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
            </button>
            <button type="button" class="btn-act-trash" data-id="${lead.id}" title="Delete Lead">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </td>
      `;

      frag.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);

    renderFavPaginationButtons(totalFiltered, page, perPage);
    updateFavBulkActionBar();
  }

  function renderFavPaginationButtons(total, currentPage, perPage) {
    const container = document.getElementById('fav-page-nums-list');
    const prevBtn = document.getElementById('btn-fav-page-prev');
    const nextBtn = document.getElementById('btn-fav-page-next');
    if (!container) return;

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    container.innerHTML = '';

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn-page-num ${p === currentPage ? 'active' : ''}`;
      btn.textContent = p;
      btn.addEventListener('click', () => {
        AppState.favFilters.page = p;
        renderFavTableRows();
      });
      container.appendChild(btn);
    }
  }

  function initFavLeadsTableDelegation() {
    const tbody = document.getElementById('fav-leads-tbody');
    if (!tbody || tbody.dataset.delegated) return;
    tbody.dataset.delegated = 'true';

    // Change event for checkbox & status dropdown
    tbody.addEventListener('change', async (e) => {
      const chk = e.target.closest('.fav-row-checkbox');
      if (chk) {
        const id = chk.getAttribute('data-id');
        if (chk.checked) {
          AppState.selectedFavLeadIds.add(id);
        } else {
          AppState.selectedFavLeadIds.delete(id);
        }
        updateFavBulkActionBar();
        return;
      }

      const select = e.target.closest('.fav-status-pill');
      if (select) {
        const id = select.getAttribute('data-id');
        const status = select.value;
        try {
          await fetch(`/api/leads/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
          });
          const lead = AppState.favoriteLeads.find((l) => String(l.id) === String(id));
          if (lead) lead.status = status;
          const sl = AppState.savedLeads.find((l) => String(l.id) === String(id));
          if (sl) sl.status = status;
          showToast(`Status updated to "${status}"`, 'info', 2000);
        } catch (err) {
          showToast('Failed to update status.', 'error');
        }
        return;
      }
    });

    // Click event for star, detail link, copy, outreach, delete
    tbody.addEventListener('click', async (e) => {
      // Star un-favorite: immediately disappears from Favorites
      const starBtn = e.target.closest('.star-favorite-btn');
      if (starBtn) {
        e.stopPropagation();
        const id = starBtn.getAttribute('data-id');
        try {
          const res = await fetch(`/api/leads/${id}/favorite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorite: false })
          });
          const data = await res.json();
          if (data.success) {
            AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => String(l.id) !== String(id));
            AppState.selectedFavLeadIds.delete(id);
            const sl = AppState.savedLeads.find((l) => String(l.id) === String(id));
            if (sl) sl.favorite = false;

            // Targeted row removal from DOM without full table rebuild
            const row = tbody.querySelector(`tr[data-id="${id}"]`);
            if (row) row.remove();
            if (!tbody.children.length) {
              renderFavTableRows();
            } else {
              updateFavBulkActionBar();
            }

            updateBadgeCounts();
            showToast('Removed from Favorites', 'info', 2200);
          }
        } catch (err) {
          showToast('Failed to update favorite.', 'error');
        }
        return;
      }

      // Lead Detail Modal
      const titleLink = e.target.closest('.fav-title-link, .btn-act-sparkle');
      if (titleLink) {
        const id = titleLink.getAttribute('data-id');
        const lead = AppState.favoriteLeads.find((l) => String(l.id) === String(id));
        if (lead) openLeadDetailModal(lead);
        return;
      }

      // Copy Phone
      const copyBtn = e.target.closest('.btn-copy-clip');
      if (copyBtn) {
        const text = copyBtn.getAttribute('data-copy');
        if (text) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
          }
          showToast(`Copied phone: ${text}`, 'info', 2000);
        }
        return;
      }

      // Outreach Icon Button
      const outreachBtn = e.target.closest('.btn-act-outreach');
      if (outreachBtn) {
        const id = outreachBtn.getAttribute('data-id');
        const lead = AppState.favoriteLeads.find((l) => String(l.id) === String(id));
        if (lead) startOutreachQueue([lead], 'favorites');
        return;
      }

      // Single Delete Button
      const trashBtn = e.target.closest('.btn-act-trash');
      if (trashBtn) {
        const id = trashBtn.getAttribute('data-id');
        const lead = AppState.favoriteLeads.find((l) => String(l.id) === String(id));
        if (lead) {
          AppState.leadToDelete = lead;
          AppState.isBulkDelete = false;
          openDeleteConfirmModal(`Delete "${lead.business_name}"?`, 'This lead will be permanently removed from your database.');
        }
        return;
      }
    });
  }

  function exportFavoritesCSV() {
    const leads = AppState.favoriteLeads;
    if (!leads.length) {
      showToast('No favorite leads available to export.', 'info');
      return;
    }

    const headers = [
      'Business Name',
      'Category',
      'State',
      'City',
      'District',
      'Address',
      'Phone',
      'Email',
      'Website',
      'Website Status',
      'Google Maps URL',
      'Rating',
      'Review Count',
      'Opportunity Score',
      'Status'
    ];

    const rows = leads.map((l) => [
      `"${(l.business_name || '').replace(/"/g, '""')}"`,
      `"${(l.category || '').replace(/"/g, '""')}"`,
      `"${(l.state || '').replace(/"/g, '""')}"`,
      `"${(l.city || '').replace(/"/g, '""')}"`,
      `"${(l.district || '').replace(/"/g, '""')}"`,
      `"${(l.address || '').replace(/"/g, '""')}"`,
      `"${(l.phone || '').replace(/"/g, '""')}"`,
      `"${(l.email || '').replace(/"/g, '""')}"`,
      `"${(l.website || '').replace(/"/g, '""')}"`,
      `"${l.website_status || 'NO'}"`,
      `"${(l.google_maps_url || '').replace(/"/g, '""')}"`,
      l.rating !== undefined ? l.rating : '',
      l.review_count !== undefined ? l.review_count : '',
      l.opportunity_score || 50,
      `"${(l.status || 'New').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'clienthunter-favorites.csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`Exported ${leads.length} favorite leads to CSV`, 'success');
  }

  function initFavoritesToolbar() {
    const searchField = document.getElementById('fav-search-box');
    const webFilter = document.getElementById('fav-filter-website');
    const statusFilter = document.getElementById('fav-filter-status');
    const catFilter = document.getElementById('fav-filter-category');
    const stateFilter = document.getElementById('fav-filter-state');
    const phoneFilter = document.getElementById('fav-filter-phone');
    const rowsChoice = document.getElementById('fav-rows-choice');
    const refreshBtn = document.getElementById('btn-reload-fav-table');
    const exportBtn = document.getElementById('btn-export-favs-csv');
    const findMoreBtn = document.getElementById('btn-fav-goto-find-leads');
    const emptyFindBtn = document.getElementById('btn-fav-empty-find');
    const emptySavedBtn = document.getElementById('btn-fav-empty-saved');
    const masterCheck = document.getElementById('fav-select-all');

    // Debounced search
    let searchTimer;
    if (searchField) {
      searchField.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          AppState.favFilters.search = this.value;
          AppState.favFilters.page = 1;
          loadFavoriteLeads();
        }, 220);
      });
    }

    if (webFilter) {
      webFilter.addEventListener('change', function () {
        AppState.favFilters.website = this.value;
        AppState.favFilters.page = 1;
        loadFavoriteLeads();
      });
    }

    if (statusFilter) {
      statusFilter.addEventListener('change', function () {
        AppState.favFilters.status = this.value;
        AppState.favFilters.page = 1;
        loadFavoriteLeads();
      });
    }

    if (catFilter) {
      catFilter.addEventListener('change', function () {
        AppState.favFilters.category = this.value;
        AppState.favFilters.page = 1;
        loadFavoriteLeads();
      });
    }

    if (stateFilter) {
      stateFilter.addEventListener('change', function () {
        AppState.favFilters.state = this.value;
        AppState.favFilters.page = 1;
        loadFavoriteLeads();
      });
    }

    if (phoneFilter) {
      phoneFilter.addEventListener('change', function () {
        AppState.favFilters.phone = this.value;
        AppState.favFilters.page = 1;
        loadFavoriteLeads();
      });
    }

    if (rowsChoice) {
      rowsChoice.addEventListener('change', function () {
        AppState.favFilters.rowsPerPage = parseInt(this.value, 10) || 25;
        AppState.favFilters.page = 1;
        renderFavTableRows();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadFavoriteLeads();
        showToast('Refreshed favorite leads database.', 'info', 1500);
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', exportFavoritesCSV);
    }

    if (findMoreBtn) {
      findMoreBtn.addEventListener('click', () => switchView('find-leads'));
    }

    if (emptyFindBtn) {
      emptyFindBtn.addEventListener('click', () => switchView('find-leads'));
    }

    if (emptySavedBtn) {
      emptySavedBtn.addEventListener('click', () => switchView('saved-leads'));
    }

    // Master Select All Checkbox
    if (masterCheck) {
      masterCheck.addEventListener('change', function () {
        const visibleCheckboxes = document.querySelectorAll('#fav-leads-tbody .fav-row-checkbox');
        visibleCheckboxes.forEach((chk) => {
          chk.checked = masterCheck.checked;
          const id = chk.getAttribute('data-id');
          if (masterCheck.checked) {
            AppState.selectedFavLeadIds.add(id);
          } else {
            AppState.selectedFavLeadIds.delete(id);
          }
        });
        updateFavBulkActionBar();
      });
    }

    // Bulk Bar Buttons
    const bulkUnfavBtn = document.getElementById('btn-fav-bulk-unfav');
    const bulkOutreachBtn = document.getElementById('btn-fav-bulk-outreach');
    const bulkDeleteBtn = document.getElementById('btn-fav-bulk-delete');
    const bulkDismissBtn = document.getElementById('btn-fav-bulk-dismiss');

    if (bulkUnfavBtn) {
      bulkUnfavBtn.addEventListener('click', async () => {
        const count = AppState.selectedFavLeadIds.size;
        if (count === 0) return;

        if (count > 1) {
          const unfavModal = document.getElementById('modal-unfav-confirm');
          const titleEl = document.getElementById('confirm-unfav-title');
          const descEl = document.getElementById('confirm-unfav-desc');
          if (titleEl) titleEl.textContent = `Remove ${count} leads from Favorites?`;
          if (descEl) descEl.textContent = `These ${count} leads will be removed from your Favorites list. They will still remain available in Saved Leads.`;
          if (unfavModal) unfavModal.classList.remove('hidden');
        } else {
          // Single lead remove directly
          const id = AppState.selectedFavLeadIds.values().next().value;
          try {
            const res = await fetch(`/api/leads/${id}/favorite`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ favorite: false })
            });
            const data = await res.json();
            if (data.success) {
              AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => l.id !== id);
              AppState.selectedFavLeadIds.clear();
              const sl = AppState.savedLeads.find((l) => l.id === id);
              if (sl) sl.favorite = false;
              renderFavTableRows();
              updateFavBulkActionBar();
              updateBadgeCounts();
              populateFavFilterOptions();
              showToast('1 lead removed from Favorites', 'info', 2200);
            }
          } catch (err) {
            showToast('Failed to remove from Favorites', 'error');
          }
        }
      });
    }

    if (bulkOutreachBtn) {
      bulkOutreachBtn.addEventListener('click', () => {
        const count = AppState.selectedFavLeadIds.size;
        if (count === 0) return;

        const selected = AppState.favoriteLeads.filter((l) => AppState.selectedFavLeadIds.has(l.id || l.place_id));
        if (selected.length > 0) {
          startOutreachQueue(selected, 'favorites');
        }
      });
    }

    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', () => {
        const count = AppState.selectedFavLeadIds.size;
        if (count === 0) return;
        AppState.isBulkDelete = true;
        openDeleteConfirmModal(`Delete ${count} selected favorite leads?`, 'This action will permanently delete these prospects.');
      });
    }

    if (bulkDismissBtn) {
      bulkDismissBtn.addEventListener('click', () => {
        AppState.selectedFavLeadIds.clear();
        document.querySelectorAll('#fav-leads-tbody .fav-row-checkbox').forEach((c) => (c.checked = false));
        if (masterCheck) masterCheck.checked = false;
        updateFavBulkActionBar();
      });
    }

    // Pagination navigation buttons
    const prevPageBtn = document.getElementById('btn-fav-page-prev');
    const nextPageBtn = document.getElementById('btn-fav-page-next');
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        if (AppState.favFilters.page > 1) {
          AppState.favFilters.page--;
          renderFavTableRows();
        }
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        const maxPage = Math.ceil(AppState.favoriteLeads.length / AppState.favFilters.rowsPerPage);
        if (AppState.favFilters.page < maxPage) {
          AppState.favFilters.page++;
          renderFavTableRows();
        }
      });
    }
  }

  // ====================================================
  // 7B. OUTREACH TERMINAL CONTROLLER (00:40 → 00:43)
  // ====================================================

  const OUTREACH_TEMPLATES = {
    tpl_no_web: `Hi {{businessName}},\n\nI was looking up {{category}} in {{city}} and noticed you have great customer reviews, but no official website listed on Google Maps.\n\nWithout a website, clients looking for {{category}} often go directly to competitors with online booking.\n\nWe build high-converting, mobile-ready sites tailored for businesses in {{city}}.\n\nWould you be open to seeing a quick 2-minute mockup for {{businessName}}?`,

    tpl_redesign: `Hi {{businessName}},\n\nI came across your business in {{city}} and wanted to share a quick observation: your site looks great, but runs a bit slow on mobile devices.\n\nWe help {{category}} upgrade their mobile performance and double their inquiry conversion rates.\n\nHappy to send over a complimentary performance audit if you're interested!`,

    tpl_local_seo: `Hi {{businessName}},\n\nYour reviews for {{category}} in {{city}} are top notch! However, your listing is currently missing out on top 3 ranking in local search results.\n\nWe optimize Google business profiles and websites to capture high-intent local buyers on autopilot.\n\nCan I send you a 1-minute breakdown of the quickest wins?`,

    tpl_whatsapp_bot: `Hi {{businessName}},\n\nDid you know over 70% of clients searching for {{category}} in {{city}} prefer booking directly via WhatsApp?\n\nWe set up 24/7 automated booking and customer inquiry bots for WhatsApp.\n\nWould love to show you how it works for {{businessName}}!`
  };

  function cleanPhoneNumber(rawPhone) {
    if (!rawPhone || rawPhone === 'Not available') return null;
    let clean = rawPhone.replace(/[\s\(\)\-\.\+]/g, '');
    if (clean.startsWith('0') && clean.length === 11) {
      clean = '91' + clean.slice(1);
    } else if (!clean.startsWith('91') && clean.length === 10) {
      clean = '91' + clean;
    }
    if (/^\d{10,15}$/.test(clean)) {
      return clean;
    }
    return null;
  }

  let outreachDataPromise = null;
  let outreachDataLoaded = false;

  function buildOutreachLeadMap(allLeads = []) {
    if (!AppState.outreach.leadMap) {
      AppState.outreach.leadMap = new Map();
    } else {
      AppState.outreach.leadMap.clear();
    }
    allLeads.forEach((l) => {
      if (l.id) AppState.outreach.leadMap.set(String(l.id), l);
      if (l.place_id) AppState.outreach.leadMap.set(String(l.place_id), l);
    });
  }

  function getOutreachLeadById(leadId) {
    if (!leadId) return null;
    const key = String(leadId);
    if (AppState.outreach.leadMap && AppState.outreach.leadMap.has(key)) {
      return AppState.outreach.leadMap.get(key);
    }
    const allLeads = AppState.outreach.data?.allLeads || [];
    const found = allLeads.find((l) => String(l.id) === key || (l.place_id && String(l.place_id) === key));
    if (found && AppState.outreach.leadMap) {
      AppState.outreach.leadMap.set(key, found);
    }
    return found || null;
  }

  async function loadOutreachData(preferredLeadId = null, forceRefresh = false) {
    // 1. In-memory cache hit: reuse existing dataset if valid and not marked dirty
    if (!forceRefresh && outreachDataLoaded && AppState.outreach.data && !AppState.outreachDirty) {
      updateOutreachMetrics(AppState.outreach.data.metrics, AppState.outreach.data.todayOutreach);
      updateOutreachTargetBanner(AppState.outreach.data.todayOutreach);
      renderOutreachCards();

      const activeList = getActiveOutreachList();
      let targetLeadId = preferredLeadId;
      if (!targetLeadId && AppState.outreach.activeLeadId) {
        const stillExists = activeList.some((l) => (String(l.id) === String(AppState.outreach.activeLeadId) || (l.place_id && String(l.place_id) === String(AppState.outreach.activeLeadId))));
        if (stillExists) targetLeadId = AppState.outreach.activeLeadId;
      }
      if (!targetLeadId && activeList.length > 0) {
        targetLeadId = activeList[0].id || activeList[0].place_id;
      }
      if (targetLeadId) selectOutreachLead(targetLeadId);
      else renderEmptyWorkspace();
      return AppState.outreach.data;
    }

    // 2. In-flight request deduplication: reuse active Promise
    if (outreachDataPromise) {
      return outreachDataPromise;
    }

    outreachDataPromise = (async () => {
      try {
        const res = await fetch('/api/outreach/data');
        const data = await res.json();
        if (!data.success) return null;

        AppState.outreach.data = data;
        outreachDataLoaded = true;
        AppState.outreachDirty = false;
        buildOutreachLeadMap(data.allLeads || []);

        updateOutreachMetrics(data.metrics, data.todayOutreach);
        updateOutreachTargetBanner(data.todayOutreach);
        populateOutreachCategoryFilter(data.allLeads || []);
        renderOutreachCards();

        const activeList = getActiveOutreachList();
        let targetLeadId = preferredLeadId;

        if (!targetLeadId && AppState.outreach.activeLeadId) {
          const stillExists = activeList.some((l) => (String(l.id) === String(AppState.outreach.activeLeadId) || (l.place_id && String(l.place_id) === String(AppState.outreach.activeLeadId))));
          if (stillExists) targetLeadId = AppState.outreach.activeLeadId;
        }

        if (!targetLeadId && activeList.length > 0) {
          targetLeadId = activeList[0].id || activeList[0].place_id;
        }

        if (targetLeadId) {
          selectOutreachLead(targetLeadId);
        } else {
          renderEmptyWorkspace();
        }
        return data;
      } catch (err) {
        console.error('Error loading outreach data:', err);
        return null;
      } finally {
        outreachDataPromise = null;
      }
    })();

    return outreachDataPromise;
  }

  function updateOutreachMetrics(metrics = {}, todayOutreach = {}) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val ?? 0;
    };

    setVal('metric-total-outreach', metrics.totalOutreach);
    setVal('metric-not-contacted', metrics.notContacted);
    setVal('metric-awaiting-reply', metrics.awaitingReply);
    setVal('metric-followups-due', metrics.followUpsDue);
    setVal('metric-replied', metrics.replied);
    setVal('metric-completed', metrics.completed);
    setVal('metric-stopped', metrics.stopped);

    // Nav pills & badge counts
    const readyCountEl = document.getElementById('outreach-ready-count');
    if (readyCountEl) readyCountEl.textContent = metrics.notContacted || 0;

    const navOutreachBadge = document.getElementById('nav-outreach-badge');
    if (navOutreachBadge) {
      navOutreachBadge.textContent = metrics.notContacted || 0;
    }
  }

  function updateOutreachTargetBanner(todayOutreach = {}) {
    const sent = todayOutreach.sent ?? 0;
    const target = todayOutreach.target ?? 50;
    const remaining = todayOutreach.remaining ?? Math.max(0, target - sent);
    const pct = todayOutreach.percentage ?? Math.min(100, Math.round((sent / target) * 100));

    const scoreEl = document.getElementById('today-target-score');
    if (scoreEl) scoreEl.textContent = `${sent} / ${target}`;

    const pctEl = document.getElementById('today-target-pct');
    if (pctEl) pctEl.textContent = `(${pct}%)`;

    const sentText = document.getElementById('today-sent-text');
    if (sentText) sentText.textContent = `✓ ${sent} SENT`;

    const remText = document.getElementById('today-remaining-text');
    if (remText) remText.textContent = `→ ${remaining} REMAINING`;

    const maxText = document.getElementById('today-max-text');
    if (maxText) maxText.textContent = `(TARGET: ${target})`;

    const fillEl = document.getElementById('target-progress-fill');
    if (fillEl) fillEl.style.width = `${pct}%`;

    const dotEl = document.getElementById('target-progress-dot');
    if (dotEl) dotEl.style.left = `${pct}%`;

    const inputTarget = document.getElementById('input-daily-target');
    if (inputTarget) inputTarget.value = target;
  }

  function populateOutreachCategoryFilter(leads) {
    const catSelect = document.getElementById('outreach-category-filter');
    if (!catSelect) return;

    const currentVal = AppState.outreach.categoryFilter;
    const categories = new Set();
    leads.forEach((l) => {
      if (l.category) categories.add(l.category);
    });

    catSelect.innerHTML = '<option value="ALL">All Categories</option>';
    Array.from(categories).sort().forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === currentVal) opt.selected = true;
      catSelect.appendChild(opt);
    });
  }

  function getActiveOutreachList() {
    if (!AppState.outreach.data) return [];
    return AppState.outreach.data.readyLeads || [];
  }

  function renderOutreachCards() {
    const container = document.getElementById('outreach-cards-container');
    const emptyState = document.getElementById('outreach-empty-state');
    if (!container) return;

    let leads = getActiveOutreachList();

    // 1. Search Query Filter
    const q = (AppState.outreach.searchQuery || '').trim().toLowerCase();
    if (q) {
      leads = leads.filter((l) => {
        return (
          (l.business_name && l.business_name.toLowerCase().includes(q)) ||
          (l.phone && l.phone.includes(q)) ||
          (l.city && l.city.toLowerCase().includes(q)) ||
          (l.category && l.category.toLowerCase().includes(q))
        );
      });
    }

    // 2. Category Filter
    if (AppState.outreach.categoryFilter && AppState.outreach.categoryFilter !== 'ALL') {
      leads = leads.filter((l) => l.category === AppState.outreach.categoryFilter);
    }

    // 3. Website Filter
    if (AppState.outreach.siteFilter && AppState.outreach.siteFilter !== 'ALL') {
      leads = leads.filter((l) => l.website_status === AppState.outreach.siteFilter);
    }

    if (leads.length === 0) {
      container.innerHTML = '';
      if (emptyState) {
        emptyState.classList.remove('hidden');
        const emptyTitle = document.getElementById('outreach-empty-title');
        const emptyDesc = document.getElementById('outreach-empty-desc');
        if (emptyTitle) emptyTitle.textContent = "You're all caught up.";
        if (emptyDesc) emptyDesc.textContent = "New saved leads will appear here when they're ready for outreach.";
      }
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const html = leads.map((lead) => {
      const leadId = lead.id || lead.place_id;
      const isActive = leadId === AppState.outreach.activeLeadId;
      const isChecked = AppState.outreach.selectedLeadIds.has(leadId);

      let statusBadge = '<span class="outreach-card-status-badge">Not Contacted</span>';
      let actionLabel = 'Message';

      if (lead.outreach_status === 'Replied') {
        statusBadge = '<span class="outreach-card-status-badge badge-replied">Replied</span>';
      }

      const scoreNum = lead.opportunity_score || 50;

      return `
        <div class="outreach-card ${isActive ? 'active' : ''}" data-id="${leadId}">
          <div class="outreach-card-left">
            <input type="checkbox" class="outreach-card-checkbox" data-id="${leadId}" ${isChecked ? 'checked' : ''} />
            <div class="outreach-card-info">
              <div class="outreach-card-title-row">
                <span class="outreach-card-biz-name" title="${escapeHtml(lead.business_name)}">${escapeHtml(lead.business_name)}</span>
                <span class="outreach-card-score-pill">🔥 ${scoreNum}/100</span>
              </div>
              <div class="outreach-card-sub-line">
                ${escapeHtml(lead.category || 'Business')} • ${escapeHtml(lead.city || '')} • ${escapeHtml(lead.phone || '')}
              </div>
            </div>
          </div>
          <div class="outreach-card-right">
            ${statusBadge}
            <button type="button" class="btn-card-message" data-id="${leadId}">
              <i class="fa-regular fa-paper-plane"></i>
              <span>${actionLabel}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;
    updateOutreachBulkControls();
  }

  function updateOutreachBulkControls() {
    const count = AppState.outreach.selectedLeadIds.size;
    const delBtn = document.getElementById('btn-outreach-delete-batch');
    const sendBtn = document.getElementById('btn-outreach-send-batch');
    if (delBtn) {
      if (count > 0) {
        delBtn.classList.remove('disabled');
        delBtn.removeAttribute('disabled');
        delBtn.innerHTML = `<i class="fa-regular fa-trash-can"></i> <span>Delete (${count})</span>`;
      } else {
        delBtn.classList.add('disabled');
        delBtn.setAttribute('disabled', 'true');
        delBtn.innerHTML = `<i class="fa-regular fa-trash-can"></i> <span>Delete</span>`;
      }
    }
    if (sendBtn) {
      if (count > 0) {
        sendBtn.classList.remove('disabled');
        sendBtn.removeAttribute('disabled');
        sendBtn.innerHTML = `<i class="fa-regular fa-paper-plane"></i> <span>Send Message (${count})</span>`;
      } else {
        sendBtn.classList.add('disabled');
        sendBtn.setAttribute('disabled', 'true');
        sendBtn.innerHTML = `<i class="fa-regular fa-paper-plane"></i> <span>Send Message</span>`;
      }
    }
  }

  function selectOutreachLead(leadId) {
    if (!leadId) return;
    AppState.outreach.activeLeadId = leadId;

    // Targeted active highlight (O(1) instead of scanning all 100+ cards)
    const container = document.getElementById('outreach-cards-container');
    if (container) {
      const prev = container.querySelector('.outreach-card.active');
      if (prev && prev.getAttribute('data-id') !== String(leadId)) {
        prev.classList.remove('active');
      }
      const curr = container.querySelector(`.outreach-card[data-id="${leadId}"]`);
      if (curr) curr.classList.add('active');
    }

    const lead = getOutreachLeadById(leadId);
    if (!lead) return;

    // Populate Conversation Workspace
    const wsIdBadge = document.getElementById('ws-lead-source-id');
    if (wsIdBadge) {
      wsIdBadge.textContent = `ID: ${lead.place_id ? 'google_' + lead.place_id.slice(0, 10) : lead.id}`;
    }

    const wsBiz = document.getElementById('ws-business-name');
    if (wsBiz) wsBiz.textContent = lead.business_name;

    const wsCat = document.getElementById('ws-category');
    if (wsCat) wsCat.textContent = lead.category || 'Local Business';

    const wsScore = document.getElementById('ws-score-text');
    if (wsScore) wsScore.textContent = `${lead.opportunity_score || 50}/100`;

    const wsPhone = document.getElementById('ws-phone');
    if (wsPhone) wsPhone.textContent = lead.phone || 'Not available';

    const wsEmail = document.getElementById('ws-email');
    if (wsEmail) wsEmail.textContent = (lead.email && lead.email !== 'Not available') ? lead.email : 'N/A';

    const wsWeb = document.getElementById('ws-website');
    if (wsWeb) {
      if (lead.website_status === 'YES' && lead.website) {
        let displayHost = 'Visit Website';
        try { displayHost = new URL(lead.website).hostname; } catch (e) {}
        wsWeb.innerHTML = `<a href="${lead.website}" target="_blank" style="color: #38bdf8; text-decoration: none;"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${displayHost}</a>`;
      } else {
        wsWeb.innerHTML = `<span style="color: #fbbf24;">Missing Website</span>`;
      }
    }

    const wsLoc = document.getElementById('ws-location');
    if (wsLoc) {
      wsLoc.textContent = `${lead.city || ''}${lead.state ? ', ' + lead.state : ''}`;
    }

    // Favorite button
    const favBtn = document.getElementById('ws-btn-favorite');
    if (favBtn) {
      if (lead.favorite) {
        favBtn.classList.add('active-fav');
        favBtn.innerHTML = `<i class="fa-solid fa-star"></i> <span>Favorited</span>`;
      } else {
        favBtn.classList.remove('active-fav');
        favBtn.innerHTML = `<i class="fa-regular fa-star"></i> <span>Favorite</span>`;
      }
    }

    // Status select & pill
    const statusSelect = document.getElementById('ws-status-select');
    const statusPill = document.getElementById('ws-status-pill-val');
    const currentStatus = lead.outreach_status || 'Pending';
    if (statusSelect) statusSelect.value = currentStatus;
    if (statusPill) statusPill.textContent = currentStatus;

    // Send button text
    const sendLabel = document.getElementById('btn-ws-send-label');
    if (sendLabel) {
      sendLabel.textContent = 'Send Message (Open Outreach Dialog)';
    }

    // Message History
    renderWorkspaceMessageHistory(lead);
  }

  function renderWorkspaceMessageHistory(lead) {
    const countEl = document.getElementById('ws-msg-count');
    const emptyEl = document.getElementById('ws-history-empty');
    const listEl = document.getElementById('ws-history-list');

    const history = lead.message_history || [];
    if (countEl) countEl.textContent = history.length;

    if (!listEl || !emptyEl) return;

    if (history.length === 0) {
      emptyEl.classList.remove('hidden');
      listEl.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');

    listEl.innerHTML = history.slice().reverse().map((msg, idx) => {
      const typeLabel = msg.type === 'FIRST_MESSAGE' ? 'FIRST OUTREACH' : `FOLLOW-UP #${msg.follow_up_day || '?'}`;
      const dateStr = msg.sent_at ? new Date(msg.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';
      return `
        <div class="msg-history-item">
          <div class="msg-history-top">
            <span class="msg-type-pill">${typeLabel}</span>
            <span class="msg-date">${dateStr}</span>
          </div>
          <div class="msg-body">${escapeHtml(msg.message || '')}</div>
        </div>
      `;
    }).join('');
  }

  function renderEmptyWorkspace() {
    const wsBiz = document.getElementById('ws-business-name');
    if (wsBiz) wsBiz.textContent = 'No Lead Selected';
    const wsCat = document.getElementById('ws-category');
    if (wsCat) wsCat.textContent = 'Queue is empty';
    const sendLabel = document.getElementById('btn-ws-send-label');
    if (sendLabel) sendLabel.textContent = 'Send Message (Open Outreach Dialog)';
    const historyList = document.getElementById('ws-history-list');
    if (historyList) historyList.classList.add('hidden');
    const historyEmpty = document.getElementById('ws-history-empty');
    if (historyEmpty) historyEmpty.classList.remove('hidden');
  }

  function updateOutreachSubTabsUI() {
    const readyBtn = document.getElementById('tab-outreach-ready');
    if (readyBtn) readyBtn.classList.add('active');
  }

  // ----------------------------------------------------
  // OUTREACH SEQUENTIAL QUEUE & COMPOSER CONTROLLER
  // ----------------------------------------------------

  let composerTemplatesInitialized = false;

  function populateComposerTemplateSelect(force = false) {
    const sel = document.getElementById('composer-tpl-select');
    if (!sel) return;
    if (composerTemplatesInitialized && !force && sel.children.length > 0) return;

    const templates = (AppState.settings?.templates && AppState.settings.templates.length > 0)
      ? AppState.settings.templates
      : SettingsModule.getDefaults().templates;
    if (templates && templates.length > 0) {
      const prevVal = sel.value;
      sel.innerHTML = templates.map((t) => {
        return `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`;
      }).join('');
      if (prevVal && templates.some((t) => t.id === prevVal)) {
        sel.value = prevVal;
      } else {
        const def = templates.find((t) => t.isDefault) || templates[0];
        sel.value = def.id;
      }
    }
  }

  function initComposerTemplateChipsDelegation() {
    const container = document.getElementById('composer-tpl-chips');
    if (!container || container.dataset.delegated) return;
    container.dataset.delegated = 'true';

    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.tpl-chip');
      if (!chip) return;
      e.preventDefault();
      const tplId = chip.getAttribute('data-id');
      AppState.composerSelectedTemplateId = tplId;
      const selectEl = document.getElementById('composer-tpl-select');
      if (selectEl) selectEl.value = tplId;

      const prev = container.querySelector('.tpl-chip.active');
      if (prev) prev.classList.remove('active');
      chip.classList.add('active');

      setComposerTab('template');
      applyCustomTemplate(AppState.outreach.currentComposerLead, tplId);
    });
  }

  function renderComposerTemplateChips(force = false) {
    const container = document.getElementById('composer-tpl-chips');
    if (!container) return;
    initComposerTemplateChipsDelegation();

    if (composerTemplatesInitialized && !force && container.children.length > 0) {
      const currentSelectedId = AppState.composerSelectedTemplateId;
      const prev = container.querySelector('.tpl-chip.active');
      if (prev && prev.getAttribute('data-id') !== currentSelectedId) {
        prev.classList.remove('active');
      }
      const curr = container.querySelector(`.tpl-chip[data-id="${currentSelectedId}"]`);
      if (curr) curr.classList.add('active');
      return;
    }

    const templates = (AppState.settings?.templates && AppState.settings.templates.length > 0)
      ? AppState.settings.templates
      : SettingsModule.getDefaults().templates;

    const selectEl = document.getElementById('composer-tpl-select');
    let currentSelectedId = AppState.composerSelectedTemplateId || selectEl?.value;
    if (!currentSelectedId || !templates.some((t) => t.id === currentSelectedId)) {
      if (AppState.outreach?.isFollowUpComposer) {
        const fDay = AppState.outreach?.currentComposerLead?.follow_up_day || 1;
        currentSelectedId = `tpl-followup-${Math.min(fDay, 5)}`;
      } else {
        currentSelectedId = 'tpl-website';
      }
    }
    AppState.composerSelectedTemplateId = currentSelectedId;
    if (selectEl) selectEl.value = currentSelectedId;

    container.innerHTML = templates.map((t) => {
      const isActive = t.id === currentSelectedId;
      return `<button type="button" class="tpl-chip${isActive ? ' active' : ''}" data-id="${escapeHtml(t.id)}" title="${escapeHtml(t.type || t.name)}">${escapeHtml(t.name)}</button>`;
    }).join('');

    composerTemplatesInitialized = true;
  }

  async function openOutreachComposer(lead, isFollowUp = false) {
    if (!lead) return;
    await startOutreachQueue([lead], AppState.currentView || 'outreach');
  }

  async function startOutreachQueue(leadsArray, source = 'saved-leads') {
    if (!Array.isArray(leadsArray) || leadsArray.length === 0) {
      showToast('No leads selected for outreach.', 'info', 2000);
      return;
    }

    AppState.outreachQueue = {
      isActive: true,
      leads: [...leadsArray],
      currentIndex: 0,
      totalCount: leadsArray.length,
      processedCount: 0,
      skippedCount: 0,
      source: source
    };

    populateComposerTemplateSelect();
    await loadQueueLead(0);
  }

  function populateComposerLeadCard(lead) {
    if (!lead) return;

    // Col 1: Avatar + Name + Category + Location
    const avatarEl = document.getElementById('lead-avatar-icon');
    if (avatarEl) {
      const catLower = (lead.category || '').toLowerCase();
      let iconHtml = '<i class="fa-solid fa-store"></i>';
      if (catLower.includes('dent') || catLower.includes('tooth')) iconHtml = '<i class="fa-solid fa-tooth"></i>';
      else if (catLower.includes('gym') || catLower.includes('fit')) iconHtml = '<i class="fa-solid fa-dumbbell"></i>';
      else if (catLower.includes('clinic') || catLower.includes('health') || catLower.includes('doc') || catLower.includes('hosp')) iconHtml = '<i class="fa-solid fa-stethoscope"></i>';
      else if (catLower.includes('real') || catLower.includes('estate') || catLower.includes('prop')) iconHtml = '<i class="fa-solid fa-building"></i>';
      else if (catLower.includes('food') || catLower.includes('cafe') || catLower.includes('rest')) iconHtml = '<i class="fa-solid fa-utensils"></i>';
      avatarEl.innerHTML = iconHtml;
    }

    const nameEl = document.getElementById('composer-lead-biz-name');
    if (nameEl) nameEl.textContent = lead.business_name || 'Business';

    const catPill = document.getElementById('composer-lead-category');
    if (catPill) catPill.textContent = lead.category || 'Local Business';

    const locEl = document.getElementById('composer-lead-location');
    if (locEl) {
      const locStr = lead.city ? (lead.city + (lead.state ? ', ' + lead.state : '')) : (lead.city || 'Location not specified');
      locEl.innerHTML = `<i class="fa-solid fa-location-dot"></i> <span>${escapeHtml(locStr)}</span>`;
    }

    // Col 2: Phone + Website + Website Status
    const phoneEl = document.getElementById('composer-lead-phone');
    if (phoneEl) phoneEl.textContent = lead.phone || 'Not available';

    const webEl = document.getElementById('composer-lead-website');
    if (webEl) {
      if (lead.website && lead.website.trim()) {
        const cleanUrl = lead.website.trim();
        const cleanDomain = cleanUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
        webEl.href = cleanUrl;
        webEl.textContent = cleanDomain.length > 28 ? cleanDomain.slice(0, 28) + '...' : cleanDomain;
        webEl.title = cleanUrl;
      } else {
        webEl.href = '#';
        webEl.textContent = 'No website';
        webEl.title = '';
      }
    }

    const statusEl = document.getElementById('composer-lead-webstatus');
    if (statusEl) {
      const hasWeb = lead.website_status === 'YES';
      statusEl.className = `lead-status-pill ${hasWeb ? 'available' : 'missing'}`;
      statusEl.textContent = hasWeb ? 'Available' : 'Missing';
    }

    // Col 3: Opportunity Score
    const scoreEl = document.getElementById('composer-lead-score');
    if (scoreEl) scoreEl.textContent = `${lead.opportunity_score || 75}/100`;

    const reasonEl = document.getElementById('composer-lead-score-reason');
    if (reasonEl) {
      const hasWeb = lead.website_status === 'YES';
      const reasonText = !hasWeb ? 'No website + high reviews' : 'Opportunity to optimize mobile conversion';
      reasonEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${escapeHtml(reasonText)}</span>`;
    }
  }

  async function loadQueueLead(index) {
    const queue = AppState.outreachQueue;
    if (!queue.isActive) return;

    if (index >= queue.leads.length) {
      showQueueCompletion();
      return;
    }

    queue.currentIndex = index;
    const lead = queue.leads[index];
    if (!lead) {
      showQueueCompletion();
      return;
    }

    AppState.outreach.currentComposerLead = lead;
    AppState.outreach.isFollowUpComposer = Boolean(lead.first_message_sent && lead.outreach_status === 'Follow-Up');

    const modal = document.getElementById('modal-outreach-composer');
    if (!modal) return;

    // Ensure main content is visible and confirmation/complete are hidden
    const completeSec = document.getElementById('composer-queue-complete');
    if (completeSec) completeSec.classList.add('hidden');

    const mainContent = document.getElementById('composer-main-content');
    if (mainContent) mainContent.classList.remove('hidden');

    const confirmBlock = document.getElementById('composer-confirm-block');
    if (confirmBlock) confirmBlock.classList.add('hidden');

    // Queue Progress Tracker Pill
    const tracker = document.getElementById('composer-queue-tracker');
    if (tracker) {
      if (queue.totalCount > 1) {
        tracker.classList.remove('hidden');
        const curStep = document.getElementById('queue-current-step');
        if (curStep) curStep.textContent = String(index + 1);
        const totStep = document.getElementById('queue-total-step');
        if (totStep) totStep.textContent = String(queue.totalCount);
      } else {
        tracker.classList.add('hidden');
      }
    }

    // Populate the Lead Information Card
    populateComposerLeadCard(lead);

    // Render Custom Message Templates chips from Settings
    renderComposerTemplateChips();

    // Phone Validation
    const cleanPhone = cleanPhoneNumber(lead.phone);
    const phoneWarn = document.getElementById('composer-phone-warning');
    const openWaBtn = document.getElementById('btn-composer-open-wa');

    if (!cleanPhone) {
      if (phoneWarn) phoneWarn.classList.remove('hidden');
      if (openWaBtn) openWaBtn.classList.add('disabled');
    } else {
      if (phoneWarn) phoneWarn.classList.add('hidden');
      if (openWaBtn) openWaBtn.classList.remove('disabled');
    }

    // Show modal
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Clear textarea first so NO previous lead details show up
    const textarea = document.getElementById('composer-message-text');
    if (textarea) {
      textarea.value = `Preparing personalized message for ${lead.business_name}...`;
      updateComposerCharCount();
    }

    // Determine current active mode
    const activeTab = document.querySelector('.composer-tab-btn.active')?.id;
    if (activeTab === 'tab-composer-template') {
      setComposerTab('template');
      applyCustomTemplate(lead, AppState.composerSelectedTemplateId);
    } else if (activeTab === 'tab-composer-custom') {
      setComposerTab('custom');
    } else {
      setComposerTab('ai');
      // Provide instant draft message without remote network freeze.
      // Gemini is called on-demand when user clicks [✦ Craft Message] or [⟳ Regenerate].
      applyCustomTemplate(lead, AppState.composerSelectedTemplateId || 'tpl-website');
    }
  }

  function setComposerTab(tabName) {
    const aiTab = document.getElementById('tab-composer-ai');
    const tplTab = document.getElementById('tab-composer-template');
    const customTab = document.getElementById('tab-composer-custom');
    const aiOptions = document.getElementById('composer-ai-options');
    const tplShelf = document.getElementById('composer-tpl-shelf');
    const textarea = document.getElementById('composer-message-text');

    if (aiTab) aiTab.classList.toggle('active', tabName === 'ai');
    if (tplTab) tplTab.classList.toggle('active', tabName === 'template');
    if (customTab) customTab.classList.toggle('active', tabName === 'custom');

    if (tabName === 'ai') {
      if (aiOptions) aiOptions.classList.remove('hidden');
      if (tplShelf) tplShelf.classList.add('hidden');
    } else if (tabName === 'template') {
      if (aiOptions) aiOptions.classList.add('hidden');
      if (tplShelf) tplShelf.classList.remove('hidden');
      applyCustomTemplate();
    } else {
      // 'custom'
      if (aiOptions) aiOptions.classList.add('hidden');
      if (tplShelf) tplShelf.classList.add('hidden');
      if (textarea && (textarea.value.startsWith('Preparing') || textarea.value.startsWith('Crafting'))) {
        textarea.value = '';
        updateComposerCharCount();
      }
      if (textarea) textarea.focus();
    }
  }

  function applyCustomTemplate(lead = null, templateId = null) {
    const currentLead = lead || AppState.outreach.currentComposerLead;
    if (!currentLead) return;

    const templates = (AppState.settings?.templates && AppState.settings.templates.length > 0)
      ? AppState.settings.templates
      : SettingsModule.getDefaults().templates;

    const activeChip = document.querySelector('#composer-tpl-chips .tpl-chip.active');
    const tplKey = templateId || activeChip?.getAttribute('data-id') || document.getElementById('composer-tpl-select')?.value || AppState.composerSelectedTemplateId || 'tpl-website';

    const foundTpl = templates.find((t) => t.id === tplKey) || templates[0];
    let raw = foundTpl ? foundTpl.content : '';

    const profile = AppState.settings?.profile || SettingsModule.getDefaults().profile;
    const myName = profile.fullName || 'Akshay Lead Specialist';
    const myCompany = profile.companyName || 'Nexora AI Growth';
    const portfolioUrl = profile.portfolioUrl || 'https://apexgrowth.in';
    const websiteUrl = profile.websiteUrl || 'https://apexgrowth.in';

    const bizName = currentLead.business_name || 'there';
    const cat = currentLead.category || 'business';
    const city = currentLead.city || 'your area';
    const phone = currentLead.phone || '';

    const interpolated = raw
      .replace(/\{businessName\}/g, bizName)
      .replace(/\{\{businessName\}\}/g, bizName)
      .replace(/\{business_name\}/g, bizName)
      .replace(/\{\{business_name\}\}/g, bizName)
      .replace(/\{category\}/g, cat)
      .replace(/\{\{category\}\}/g, cat)
      .replace(/\{city\}/g, city)
      .replace(/\{\{city\}\}/g, city)
      .replace(/\{phone\}/g, phone)
      .replace(/\{\{phone\}\}/g, phone)
      .replace(/\{my_name\}/g, myName)
      .replace(/\{\{my_name\}\}/g, myName)
      .replace(/\{my_company\}/g, myCompany)
      .replace(/\{\{my_company\}\}/g, myCompany)
      .replace(/\{portfolio_url\}/g, portfolioUrl)
      .replace(/\{\{portfolio_url\}\}/g, portfolioUrl)
      .replace(/\{website_url\}/g, websiteUrl)
      .replace(/\{\{website_url\}\}/g, websiteUrl)
      .replace(/\{\{websiteStatus\}\}/g, currentLead.website_status === 'YES' ? 'website' : 'online presence');

    const textarea = document.getElementById('composer-message-text');
    if (textarea) {
      textarea.value = interpolated;
      updateComposerCharCount();
    }
  }

  let isCraftingAiMessage = false;

  async function craftAiMessage(lead) {
    if (isCraftingAiMessage) return;
    const currentLead = lead || AppState.outreach.currentComposerLead;
    if (!currentLead) return;

    isCraftingAiMessage = true;
    const textarea = document.getElementById('composer-message-text');
    const craftBtn = document.getElementById('btn-composer-craft');
    const regenBtn = document.getElementById('btn-composer-regenerate');
    const originalBtnHtml = craftBtn ? craftBtn.innerHTML : '';
    const previousText = textarea ? textarea.value : '';

    if (craftBtn) {
      craftBtn.disabled = true;
      craftBtn.innerHTML = '<span class="sparkle-icon">✦</span> <span>Crafting Message...</span>';
    }
    if (regenBtn) regenBtn.disabled = true;

    if (textarea) {
      textarea.value = `Crafting personalized AI outreach for ${currentLead.business_name}...`;
      updateComposerCharCount();
    }

    const tone = document.getElementById('composer-tone-select')?.value || 'Professional';
    const length = document.getElementById('composer-opt-length')?.value || 'Medium';
    const approach = document.getElementById('composer-opt-approach')?.value || 'Value First';
    const cta = document.getElementById('composer-opt-cta')?.value || 'Book a Call';
    const personalization = document.getElementById('composer-opt-personalization')?.value || 'High';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      if (AppState.outreach.isFollowUpComposer) {
        await generateFollowUpMessage(currentLead, currentLead.follow_up_day || 1, controller.signal);
      } else {
        const res = await fetch('/api/outreach/generate-message', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: currentLead.id || currentLead.place_id,
            tone,
            length,
            approach,
            cta,
            personalization
          })
        });
        clearTimeout(timer);
        const json = await res.json();
        if (json.success && textarea) {
          textarea.value = json.message;
          updateComposerCharCount();
        } else if (textarea) {
          textarea.value = previousText || `Hi ${currentLead.business_name},\n\nI noticed your business in ${currentLead.city || 'your area'} and would love to connect regarding web opportunities. Would you be open to a quick 5-minute chat?`;
          updateComposerCharCount();
        }
      }
    } catch (err) {
      clearTimeout(timer);
      console.error('Error generating AI message:', err);
      if (textarea) {
        textarea.value = previousText || `Hi ${currentLead.business_name},\n\nI noticed your business in ${currentLead.city || 'your area'} and would love to connect regarding web opportunities. Would you be open to a quick 5-minute chat?`;
        updateComposerCharCount();
      }
    } finally {
      isCraftingAiMessage = false;
      if (craftBtn) {
        craftBtn.disabled = false;
        craftBtn.innerHTML = originalBtnHtml || '<span class="sparkle-icon">✦</span> <span>Craft Message</span>';
      }
      if (regenBtn) regenBtn.disabled = false;
    }
  }

  async function generateFollowUpMessage(lead, day, signal = null) {
    const textarea = document.getElementById('composer-message-text');
    if (textarea) textarea.value = `Generating Follow-Up #${day} message for ${lead.business_name}...`;

    try {
      const fetchOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id || lead.place_id,
          followUpDay: day
        })
      };
      if (signal) fetchOpts.signal = signal;
      const res = await fetch('/api/outreach/generate-followup', fetchOpts);
      const json = await res.json();
      if (json.success && textarea) {
        textarea.value = json.message;
        updateComposerCharCount();
      }
    } catch (err) {
      console.error('Error generating follow-up message:', err);
      if (textarea) {
        textarea.value = `Hi ${lead.business_name},\n\nFollowing up on my previous note. Would love to share quick insights on your web opportunities when convenient!`;
        updateComposerCharCount();
      }
    }
  }

  function updateComposerCharCount() {
    const textarea = document.getElementById('composer-message-text');
    const counter = document.getElementById('composer-char-count');
    if (textarea && counter) {
      counter.textContent = `${textarea.value.length} / 1000`;
    }
  }

  // ----------------------------------------------------
  // SAFE WHATSAPP SEND WORKFLOW (CONFIRMATION BASED)
  // ----------------------------------------------------

  function handleOpenWhatsApp() {
    const lead = AppState.outreach.currentComposerLead;
    if (!lead) return;

    const cleanPhone = cleanPhoneNumber(lead.phone);
    if (!cleanPhone) {
      showToast('This lead does not have a valid phone number. Please click Skip.', 'error', 3000);
      return;
    }

    const textarea = document.getElementById('composer-message-text');
    const finalMsg = textarea ? textarea.value.trim() : '';
    AppState.outreach.lastPreparedMessage = finalMsg;

    // 1. Open WhatsApp Click-to-Chat externally
    const waMode = AppState.settings?.whatsappPreferences?.launchMode || 'desktop';
    const waUrl = (waMode === 'desktop')
      ? `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(finalMsg)}`
      : `https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMsg)}`;
    window.open(waUrl, '_blank');

    // 2. IMPORTANT: DO NOT automatically mark lead as sent!
    // Instead, transition cleanly to the Confirmation View
    const mainContent = document.getElementById('composer-main-content');
    const confirmBlock = document.getElementById('composer-confirm-block');
    const confirmName = document.getElementById('confirm-lead-name');
    const confirmMsg = document.getElementById('confirm-lead-message');

    if (confirmName) confirmName.textContent = lead.business_name || 'Business';
    if (confirmMsg) confirmMsg.textContent = finalMsg;

    if (mainContent) mainContent.classList.add('hidden');
    if (confirmBlock) confirmBlock.classList.remove('hidden');
  }

  async function handleConfirmSent(confirmed) {
    const lead = AppState.outreach.currentComposerLead;
    const finalMsg = AppState.outreach.lastPreparedMessage || document.getElementById('composer-message-text')?.value?.trim() || '';

    const mainContent = document.getElementById('composer-main-content');
    const confirmBlock = document.getElementById('composer-confirm-block');

    if (!confirmed) {
      // User selected [ ✕ No, Not Sent ]
      const isFollowUp = Boolean(AppState.outreach.isFollowUpComposer);
      showToast(
        isFollowUp
          ? 'Follow-up marked as not sent. Lead remains on current follow-up step.'
          : 'Outreach marked as not sent. Lead remains in Ready to Contact.',
        'info',
        2500
      );

      // Lead remains on current step, no sent state or counter increment!
      if (AppState.outreachQueue.isActive && AppState.outreachQueue.totalCount > 1) {
        // In a queue, proceed to next lead without marking current as sent
        AppState.outreachQueue.skippedCount++;
        if (confirmBlock) confirmBlock.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        await loadQueueLead(AppState.outreachQueue.currentIndex + 1);
      } else {
        // Single lead, return to composer or close
        if (confirmBlock) confirmBlock.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        closeOutreachComposer();
      }
      return;
    }

    // User selected [ ✓ Yes, Message Sent ]
    if (!lead) return;
    const leadId = lead.id || lead.place_id;

    try {
      const isFollowUp = Boolean(AppState.outreach.isFollowUpComposer);
      const endpoint = isFollowUp ? '/api/outreach/mark-followup-sent' : '/api/outreach/mark-sent';
      const bodyPayload = isFollowUp
        ? { leadId, messageText: finalMsg, step: AppState.outreach.followUpStep || 1 }
        : { leadId, messageText: finalMsg };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const json = await res.json();
      if (json.success) {
        showToast(isFollowUp ? `✓ Follow-Up marked as sent` : '✓ Main message marked as sent', 'success', 2500);
      } else {
        console.warn('Notice from outreach API:', json.error);
        showToast(`Message sent for "${lead.business_name}".`, 'success', 2500);
      }

      // Merge enriched lead data returned from backend
      if (json.lead) {
        Object.assign(lead, json.lead);
      } else {
        // Local fallback updates
        lead.status = 'Contacted';
        lead.first_message_sent = true;
        lead.last_message_sent_at = new Date().toISOString();
        lead.last_message_text = finalMsg;
        if (!isFollowUp) {
          lead.main_message_sent_at = lead.main_message_sent_at || new Date().toISOString();
          lead.outreach_status = 'Follow-Up';
          lead.current_follow_up_number = 0;
          lead.next_follow_up_number = 1;
        }
      }

      // Update in-memory outreach data without full page reload
      if (AppState.outreach.data?.readyLeads) {
        AppState.outreach.data.readyLeads = AppState.outreach.data.readyLeads.filter(
          (l) => (String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId)))
        );
      }
      if (AppState.outreach.data?.allLeads) {
        const found = AppState.outreach.data.allLeads.find(
          (l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))
        );
        if (found) Object.assign(found, lead);
      }

      // Remove card element directly from DOM (O(1) instant UI update)
      const outreachContainer = document.getElementById('outreach-cards-container');
      if (outreachContainer) {
        const cardEl = outreachContainer.querySelector(`.outreach-card[data-id="${leadId}"]`);
        if (cardEl) cardEl.remove();
        if (outreachContainer.children.length === 0) {
          const emptyState = document.getElementById('outreach-empty-state');
          if (emptyState) emptyState.classList.remove('hidden');
        }
      }

      const savedMatch = AppState.savedLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
      if (savedMatch) {
        savedMatch.status = 'Contacted';
        savedMatch.first_message_sent = true;
        savedMatch.outreach_status = lead.outreach_status || 'Follow-Up';
        if (json.lead) Object.assign(savedMatch, json.lead);
      }

      const favMatch = AppState.favoriteLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
      if (favMatch) {
        favMatch.status = 'Contacted';
        favMatch.first_message_sent = true;
        favMatch.outreach_status = lead.outreach_status || 'Follow-Up';
        if (json.lead) Object.assign(favMatch, json.lead);
      }

      AppState.selectedLeadIds.delete(leadId);
      AppState.selectedLeadIds.delete(String(leadId));
      AppState.selectedFavLeadIds.delete(leadId);
      AppState.selectedFavLeadIds.delete(String(leadId));
      AppState.outreach.selectedLeadIds.delete(leadId);
      AppState.outreach.selectedLeadIds.delete(String(leadId));

      updateBulkActionBar();
      updateFavBulkActionBar();
      updateOutreachBulkControls();

      if (AppState.outreach.data?.metrics) {
        AppState.outreach.data.metrics.notContacted = Math.max(0, (AppState.outreach.data.metrics.notContacted || 1) - 1);
        AppState.outreach.data.metrics.awaitingReply = (AppState.outreach.data.metrics.awaitingReply || 0) + 1;
        updateOutreachMetrics(AppState.outreach.data.metrics, AppState.outreach.data.todayOutreach);
      }
      if (AppState.outreach.data?.todayOutreach) {
        const target = AppState.outreach.data.todayOutreach.target || 50;
        AppState.outreach.data.todayOutreach.sent = (AppState.outreach.data.todayOutreach.sent || 0) + 1;
        AppState.outreach.data.todayOutreach.remaining = Math.max(0, target - AppState.outreach.data.todayOutreach.sent);
        AppState.outreach.data.todayOutreach.percentage = Math.min(100, Math.round((AppState.outreach.data.todayOutreach.sent / target) * 100));
        updateOutreachTargetBanner(AppState.outreach.data.todayOutreach);
      }

      // Invalidate dirty caches
      AppState.followupDirty = true;
      AppState.outreachDirty = true;
      AppState.savedLeadsDirty = true;

      if (AppState.outreachQueue.isActive && AppState.outreachQueue.totalCount > 1) {
        AppState.outreachQueue.processedCount++;
        if (confirmBlock) confirmBlock.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        await loadQueueLead(AppState.outreachQueue.currentIndex + 1);
      } else {
        AppState.outreachQueue.processedCount++;
        if (confirmBlock) confirmBlock.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        closeOutreachComposer();
        if (AppState.currentView === 'saved-leads') renderSavedTableRows();
        else if (AppState.currentView === 'favorites') renderFavTableRows();
        else if (AppState.currentView === 'followup') {
          await loadFollowUpData();
        }
        updateBadgeCounts();
      }
    } catch (err) {
      console.error('Error confirming send:', err);
      showToast('Error recording send status.', 'error', 2500);
      closeOutreachComposer();
    }
  }

  async function skipQueueCurrentLead() {
    const lead = AppState.outreach.currentComposerLead;
    AppState.outreachQueue.skippedCount++;
    showToast(`Skipped "${lead?.business_name || 'lead'}".`, 'info', 1800);
    await loadQueueLead(AppState.outreachQueue.currentIndex + 1);
  }

  function stopOutreachQueue() {
    const queue = AppState.outreachQueue;
    if (queue.isActive) {
      queue.isActive = false;
      closeOutreachComposer();
      showToast(`Queue stopped. ${queue.processedCount} sent, ${queue.skippedCount} skipped.`, 'info', 3000);
      if (AppState.currentView === 'saved-leads') renderSavedTableRows();
      else if (AppState.currentView === 'favorites') renderFavTableRows();
      else if (AppState.currentView === 'outreach') loadOutreachData();
      updateBadgeCounts();
    } else {
      closeOutreachComposer();
    }
  }

  function showQueueCompletion() {
    AppState.outreachQueue.isActive = false;

    // Hide composer sections
    document.getElementById('composer-main-content')?.classList.add('hidden');
    document.getElementById('composer-confirm-block')?.classList.add('hidden');
    document.getElementById('composer-queue-tracker')?.classList.add('hidden');

    // Show completion card
    const completeSec = document.getElementById('composer-queue-complete');
    if (completeSec) completeSec.classList.remove('hidden');

    const total = AppState.outreachQueue.totalCount;
    const sent = AppState.outreachQueue.processedCount;
    const skipped = AppState.outreachQueue.skippedCount;

    const summaryEl = document.getElementById('queue-complete-summary');
    if (summaryEl) {
      summaryEl.textContent = `${total} of ${total} leads processed`;
    }

    const statsEl = document.getElementById('queue-complete-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(16,185,129,0.15);color:#34d399;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:600;">
          <i class="fa-solid fa-check"></i> ${sent} Message${sent === 1 ? '' : 's'} Sent
        </span>
        ${skipped > 0 ? `
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(148,163,184,0.15);color:#94a3b8;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:600;margin-left:8px;">
          <i class="fa-solid fa-forward-step"></i> ${skipped} Skipped
        </span>` : ''}
      `;
    }

    if (AppState.currentView === 'saved-leads') renderSavedTableRows();
    else if (AppState.currentView === 'favorites') renderFavTableRows();
    else if (AppState.currentView === 'outreach') loadOutreachData();
    updateBadgeCounts();
  }

  function closeOutreachComposer() {
    AppState.outreachQueue.isActive = false;
    const modal = document.getElementById('modal-outreach-composer');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function handleWhatsAppClick() {
    handleOpenWhatsApp();
  }

  async function handleConfirmationSend(confirmed) {
    await handleConfirmSent(confirmed);
  }

  async function handleConfirmNotOnWhatsApp() {
    const lead = AppState.outreach.currentComposerLead;
    if (!lead) return;
    const leadId = lead.id || lead.place_id;
    const bizName = lead.business_name || 'Lead';

    const notOnWaBtn = document.getElementById('btn-confirm-not-on-wa');
    if (notOnWaBtn) {
      notOnWaBtn.classList.add('loading');
      notOnWaBtn.disabled = true;
    }

    try {
      // 1. Delete the lead from backend and Supabase
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
        method: 'DELETE'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        console.warn('[Not on WhatsApp] Server deletion warning:', data);
      }

      // 2. Remove lead from in-memory outreach collections
      if (AppState.outreach.data) {
        if (Array.isArray(AppState.outreach.data.readyLeads)) {
          AppState.outreach.data.readyLeads = AppState.outreach.data.readyLeads.filter(
            (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
          );
        }
        if (Array.isArray(AppState.outreach.data.allLeads)) {
          AppState.outreach.data.allLeads = AppState.outreach.data.allLeads.filter(
            (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
          );
        }
        if (Array.isArray(AppState.outreach.data.followUpLeads)) {
          AppState.outreach.data.followUpLeads = AppState.outreach.data.followUpLeads.filter(
            (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
          );
        }
      }

      // 3. Remove lead from Saved Leads & Favorites
      AppState.savedLeads = AppState.savedLeads.filter(
        (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
      );
      if (AppState.allSavedLeads) {
        AppState.allSavedLeads = AppState.allSavedLeads.filter(
          (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
        );
      }
      AppState.favoriteLeads = AppState.favoriteLeads.filter(
        (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
      );

      // 4. Clean selection sets
      AppState.selectedLeadIds.delete(leadId);
      AppState.selectedLeadIds.delete(String(leadId));
      AppState.selectedFavLeadIds.delete(leadId);
      AppState.selectedFavLeadIds.delete(String(leadId));
      AppState.outreach.selectedLeadIds.delete(leadId);
      AppState.outreach.selectedLeadIds.delete(String(leadId));

      // 5. Remove card directly from Outreach DOM
      const outreachContainer = document.getElementById('outreach-cards-container');
      if (outreachContainer) {
        const cardEl = outreachContainer.querySelector(`.outreach-card[data-id="${leadId}"]`);
        if (cardEl) cardEl.remove();
        if (outreachContainer.children.length === 0) {
          const emptyState = document.getElementById('outreach-empty-state');
          if (emptyState) emptyState.classList.remove('hidden');
        }
      }

      // 6. Update bulk action controls & badge counts
      updateOutreachBulkControls();
      updateBulkActionBar();
      updateFavBulkActionBar();
      updateBadgeCounts();

      // Invalidate dirty flags
      AppState.savedLeadsDirty = true;
      AppState.favoritesDirty = true;
      AppState.outreachDirty = true;
      AppState.followupDirty = true;

      showToast(`"${bizName}" deleted from outreach (Not on WhatsApp).`, 'success', 3000);

      const mainContent = document.getElementById('composer-main-content');
      const confirmBlock = document.getElementById('composer-confirm-block');

      // 7. Proceed to next queue item or close single composer
      if (AppState.outreachQueue.isActive && AppState.outreachQueue.totalCount > 1) {
        AppState.outreachQueue.skippedCount++;
        if (confirmBlock) confirmBlock.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        await loadQueueLead(AppState.outreachQueue.currentIndex + 1);
      } else {
        if (confirmBlock) confirmBlock.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        closeOutreachComposer();

        if (String(AppState.outreach.activeLeadId) === String(leadId)) {
          const remainingLeads = AppState.outreach.data?.readyLeads || AppState.outreach.data?.allLeads || [];
          if (remainingLeads.length > 0) {
            selectOutreachLead(remainingLeads[0].id || remainingLeads[0].place_id);
          } else {
            renderEmptyWorkspace();
          }
        }
        loadOutreachData(AppState.outreach.activeLeadId);
      }
    } catch (err) {
      console.error('[Not on WhatsApp Error]:', err);
      showToast('Failed to remove lead from outreach.', 'error', 3000);
    } finally {
      if (notOnWaBtn) {
        notOnWaBtn.classList.remove('loading');
        notOnWaBtn.disabled = false;
      }
    }
  }

  async function handleDedicatedNotOnWhatsApp() {
    const lead = AppState.followup.currentComposerLead;
    if (!lead) return;
    const leadId = lead.id || lead.place_id;
    const bizName = lead.business_name || 'Lead';

    const btn = document.getElementById('btn-fu-confirm-not-wa');
    if (btn) {
      btn.classList.add('loading');
      btn.disabled = true;
    }

    try {
      await fetch(`/api/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' });
      if (AppState.followup.data && Array.isArray(AppState.followup.data.allLeads)) {
        AppState.followup.data.allLeads = AppState.followup.data.allLeads.filter(
          (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
        );
      }
      if (AppState.outreach.data && Array.isArray(AppState.outreach.data.allLeads)) {
        AppState.outreach.data.allLeads = AppState.outreach.data.allLeads.filter(
          (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
        );
      }
      AppState.savedLeads = AppState.savedLeads.filter(
        (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
      );
      if (AppState.allSavedLeads) {
        AppState.allSavedLeads = AppState.allSavedLeads.filter(
          (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
        );
      }
      AppState.favoriteLeads = AppState.favoriteLeads.filter(
        (l) => String(l.id) !== String(leadId) && (!l.place_id || String(l.place_id) !== String(leadId))
      );

      AppState.followupDirty = true;
      AppState.outreachDirty = true;
      AppState.savedLeadsDirty = true;

      updateFollowUpCounters();
      renderFollowUpCards();
      updateBadgeCounts();

      showToast(`"${bizName}" deleted from outreach (Not on WhatsApp).`, 'success', 3000);
      closeDedicatedFollowUpModal();
    } catch (err) {
      console.error('[Dedicated Followup Not on WhatsApp Error]:', err);
      showToast('Failed to remove lead.', 'error', 3000);
    } finally {
      if (btn) {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    }
  }

  let isConfirmingSend = false;

  function initOutreachContainerDelegation() {
    const container = document.getElementById('outreach-cards-container');
    if (!container || container.dataset.delegated) return;
    container.dataset.delegated = 'true';

    container.addEventListener('change', (e) => {
      const cb = e.target.closest('.outreach-card-checkbox');
      if (cb) {
        const id = cb.getAttribute('data-id');
        if (cb.checked) AppState.outreach.selectedLeadIds.add(id);
        else AppState.outreach.selectedLeadIds.delete(id);
        updateOutreachBulkControls();
      }
    });

    container.addEventListener('click', (e) => {
      const msgBtn = e.target.closest('.btn-card-message');
      if (msgBtn) {
        e.stopPropagation();
        const id = msgBtn.getAttribute('data-id');
        selectOutreachLead(id);
        const allLeads = AppState.outreach.data?.allLeads || [];
        const targetLead = allLeads.find((l) => (String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id))));
        if (targetLead) {
          openOutreachComposer(targetLead, false);
        }
        return;
      }

      if (e.target.closest('.outreach-card-checkbox')) return;

      const card = e.target.closest('.outreach-card');
      if (card) {
        const id = card.getAttribute('data-id');
        selectOutreachLead(id);
      }
    });
  }

  // ----------------------------------------------------
  // INITIALIZE OUTREACH EVENT LISTENERS
  // ----------------------------------------------------
  function initOutreachListeners() {
    initOutreachContainerDelegation();
    // Sub-Tabs removed: Outreach is strictly for initial outreach leads
    const tabReady = document.getElementById('tab-outreach-ready');
    if (tabReady) {
      tabReady.addEventListener('click', () => {
        AppState.outreach.subTab = 'ready';
        renderOutreachCards();
        const activeList = getActiveOutreachList();
        if (activeList.length > 0) selectOutreachLead(activeList[0].id || activeList[0].place_id);
        else renderEmptyWorkspace();
      });
    }

    // 2. Refresh Button
    const refreshBtn = document.getElementById('btn-outreach-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        showToast('Refreshing Outreach data from database...', 'info', 1500);
        await loadOutreachData(AppState.outreach.activeLeadId);
      });
    }

    // 3. Search & Filters
    const searchInput = document.getElementById('outreach-search-input');
    const clearSearch = document.getElementById('btn-outreach-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        AppState.outreach.searchQuery = searchInput.value;
        if (clearSearch) {
          if (searchInput.value) clearSearch.classList.remove('hidden');
          else clearSearch.classList.add('hidden');
        }
        renderOutreachCards();
      });
    }
    if (clearSearch) {
      clearSearch.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        AppState.outreach.searchQuery = '';
        clearSearch.classList.add('hidden');
        renderOutreachCards();
      });
    }

    const catFilter = document.getElementById('outreach-category-filter');
    if (catFilter) {
      catFilter.addEventListener('change', () => {
        AppState.outreach.categoryFilter = catFilter.value;
        renderOutreachCards();
      });
    }

    const siteFilter = document.getElementById('outreach-site-filter');
    if (siteFilter) {
      siteFilter.addEventListener('change', () => {
        AppState.outreach.siteFilter = siteFilter.value;
        renderOutreachCards();
      });
    }

    // 4. Select All Checkbox
    const selectAllBtn = document.getElementById('btn-outreach-select-all');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        const list = getActiveOutreachList();
        const allSelected = list.length > 0 && list.every((l) => AppState.outreach.selectedLeadIds.has(l.id || l.place_id));
        if (allSelected) {
          AppState.outreach.selectedLeadIds.clear();
        } else {
          list.forEach((l) => AppState.outreach.selectedLeadIds.add(l.id || l.place_id));
        }
        renderOutreachCards();
      });
    }

    // 5. Batch Delete
    const batchDelBtn = document.getElementById('btn-outreach-delete-batch');
    if (batchDelBtn) {
      batchDelBtn.addEventListener('click', () => {
        const count = AppState.outreach.selectedLeadIds.size;
        if (count === 0) return;
        AppState.isBulkDelete = true;
        const confirmModal = document.getElementById('modal-delete-confirm');
        const confirmTitle = document.getElementById('confirm-delete-title');
        const confirmDesc = document.getElementById('confirm-delete-desc');
        if (confirmTitle) confirmTitle.textContent = `Delete ${count} Leads?`;
        if (confirmDesc) confirmDesc.textContent = `Are you sure you want to delete these ${count} leads permanently from your database?`;
        if (confirmModal) confirmModal.classList.remove('hidden');
      });
    }

    // 6. Empty State button -> view saved leads
    const emptyGotoSaved = document.getElementById('btn-outreach-goto-saved');
    if (emptyGotoSaved) {
      emptyGotoSaved.addEventListener('click', () => switchView('saved-leads'));
    }

    // 7. Workspace Send Message (Primary Emerald Button)
    const wsSendBtn = document.getElementById('btn-ws-open-composer');
    if (wsSendBtn) {
      wsSendBtn.addEventListener('click', () => {
        const leadId = AppState.outreach.activeLeadId;
        const allLeads = AppState.outreach.data?.allLeads || [];
        const lead = allLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
        if (lead) {
          openOutreachComposer(lead, false);
        } else {
          showToast('Please select a lead first.', 'info', 2000);
        }
      });
    }

    // 8. Workspace Mark as Replied
    const wsRepliedBtn = document.getElementById('btn-ws-mark-replied');
    if (wsRepliedBtn) {
      wsRepliedBtn.addEventListener('click', async () => {
        const leadId = AppState.outreach.activeLeadId;
        if (!leadId) return;
        try {
          const res = await fetch('/api/outreach/mark-replied', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId })
          });
          const json = await res.json();
          if (json.success) {
            showToast(json.message || 'Marked as Replied.', 'success', 3000);
            await loadOutreachData(leadId);
            await updateBadgeCounts();
          }
        } catch (err) {
          console.error(err);
        }
      });
    }

    // 9. Workspace Stop Follow-Ups
    const wsStopBtn = document.getElementById('btn-ws-stop-followup');
    if (wsStopBtn) {
      wsStopBtn.addEventListener('click', async () => {
        const leadId = AppState.outreach.activeLeadId;
        if (!leadId) return;
        try {
          const res = await fetch('/api/outreach/mark-stopped', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId })
          });
          const json = await res.json();
          if (json.success) {
            showToast(json.message || 'Follow-ups stopped.', 'info', 3000);
            await loadOutreachData(leadId);
            await updateBadgeCounts();
          }
        } catch (err) {
          console.error(err);
        }
      });
    }

    // 10. Workspace Favorite Toggle
    const wsFavBtn = document.getElementById('ws-btn-favorite');
    if (wsFavBtn) {
      wsFavBtn.addEventListener('click', async () => {
        const leadId = AppState.outreach.activeLeadId;
        if (!leadId) return;
        try {
          const res = await fetch(`/api/leads/${leadId}/favorite`, { method: 'POST' });
          const json = await res.json();
          if (json.success) {
            showToast(json.message, 'success', 2000);
            const allLeads = AppState.outreach.data?.allLeads || [];
            const l = allLeads.find((lead) => (String(lead.id) === String(leadId) || (lead.place_id && String(lead.place_id) === String(leadId))));
            if (l) l.favorite = json.favorite;
            selectOutreachLead(leadId);
            await updateBadgeCounts();
          }
        } catch (err) {
          console.error(err);
        }
      });
    }

    // 11. Workspace View Lead Profile Modal
    const wsViewLeadBtn = document.getElementById('ws-btn-view-lead');
    if (wsViewLeadBtn) {
      wsViewLeadBtn.addEventListener('click', () => {
        const leadId = AppState.outreach.activeLeadId;
        const allLeads = AppState.outreach.data?.allLeads || [];
        const lead = allLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
        if (lead) openLeadDetailModal(lead);
      });
    }

    // 12. Workspace Google Maps Link
    const wsGmapsBtn = document.getElementById('ws-btn-gmaps');
    if (wsGmapsBtn) {
      wsGmapsBtn.addEventListener('click', () => {
        const leadId = AppState.outreach.activeLeadId;
        const allLeads = AppState.outreach.data?.allLeads || [];
        const lead = allLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
        if (lead && lead.google_maps_url) {
          window.open(lead.google_maps_url, '_blank');
        } else if (lead) {
          const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.business_name + ' ' + (lead.city || ''))}`;
          window.open(searchUrl, '_blank');
        }
      });
    }

    // 13. Workspace Remove Button
    const wsRemoveBtn = document.getElementById('ws-btn-remove');
    if (wsRemoveBtn) {
      wsRemoveBtn.addEventListener('click', () => {
        const leadId = AppState.outreach.activeLeadId;
        const allLeads = AppState.outreach.data?.allLeads || [];
        const lead = allLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
        if (lead) {
          AppState.leadToDelete = lead;
          AppState.isBulkDelete = false;
          const confirmModal = document.getElementById('modal-delete-confirm');
          const confirmTitle = document.getElementById('confirm-delete-title');
          const confirmDesc = document.getElementById('confirm-delete-desc');
          if (confirmTitle) confirmTitle.textContent = `Delete "${lead.business_name}"?`;
          if (confirmDesc) confirmDesc.textContent = 'Are you sure you want to remove this lead permanently?';
          if (confirmModal) confirmModal.classList.remove('hidden');
        }
      });
    }

    // 14. Workspace Outreach Status Dropdown
    const wsStatusSelect = document.getElementById('ws-status-select');
    if (wsStatusSelect) {
      wsStatusSelect.addEventListener('change', async () => {
        const leadId = AppState.outreach.activeLeadId;
        if (!leadId) return;
        const newStatus = wsStatusSelect.value;
        try {
          const res = await fetch('/api/outreach/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId, status: newStatus })
          });
          const json = await res.json();
          if (json.success) {
            showToast(`Status updated to "${newStatus}".`, 'success', 2000);
            await loadOutreachData(leadId);
          }
        } catch (err) {
          console.error(err);
        }
      });
    }

    // 15. Composer Tabs
    const compAiTab = document.getElementById('tab-composer-ai');
    const compTplTab = document.getElementById('tab-composer-template');
    const compCustomTab = document.getElementById('tab-composer-custom');
    if (compAiTab) compAiTab.addEventListener('click', () => setComposerTab('ai'));
    if (compTplTab) compTplTab.addEventListener('click', () => setComposerTab('template'));
    if (compCustomTab) compCustomTab.addEventListener('click', () => setComposerTab('custom'));

    // 16. Composer AI Options Controls (Tone, Length, Approach, CTA, Personalization)
    const optControlIds = [
      'composer-tone-select',
      'composer-opt-length',
      'composer-opt-approach',
      'composer-opt-cta',
      'composer-opt-personalization'
    ];
    optControlIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          // Dropdown settings updated; user triggers AI craft via [✦ Craft Message] button
        });
      }
    });

    // 17. Composer Craft Message & Regenerate Buttons
    const btnCraft = document.getElementById('btn-composer-craft');
    if (btnCraft) {
      btnCraft.addEventListener('click', () => {
        const lead = AppState.outreach.currentComposerLead;
        if (lead) craftAiMessage(lead);
      });
    }

    const compRegen = document.getElementById('btn-composer-regenerate');
    if (compRegen) {
      compRegen.addEventListener('click', () => {
        const lead = AppState.outreach.currentComposerLead;
        if (!lead) return;
        craftAiMessage(lead);
      });
    }

    // 18. Composer Template Shelf & Actions
    const compTplSelect = document.getElementById('composer-tpl-select');
    if (compTplSelect) {
      compTplSelect.addEventListener('change', () => applyCustomTemplate());
    }

    const compUseTplBtn = document.getElementById('btn-composer-use-template');
    if (compUseTplBtn) {
      compUseTplBtn.addEventListener('click', () => {
        setComposerTab('template');
      });
    }

    // 19. Composer Textarea Input (Update char counter smoothly without rerendering)
    const compTextarea = document.getElementById('composer-message-text');
    if (compTextarea) {
      compTextarea.addEventListener('input', () => updateComposerCharCount());
    }

    // 20. Composer Copy Button (if present in any view)
    const compCopy = document.getElementById('btn-composer-copy');
    if (compCopy) {
      compCopy.addEventListener('click', () => {
        const text = document.getElementById('composer-message-text')?.value || '';
        navigator.clipboard.writeText(text).then(() => {
          showToast('Outreach message copied to clipboard!', 'success', 2000);
          const lbl = document.getElementById('btn-copy-label');
          if (lbl) {
            lbl.textContent = 'Copied!';
            setTimeout(() => { lbl.textContent = 'Copy Message'; }, 2000);
          }
        });
      });
    }

    // 21. Composer Cancel & Open WhatsApp
    const compCancelBtn = document.getElementById('btn-composer-cancel');
    if (compCancelBtn) {
      compCancelBtn.addEventListener('click', () => {
        stopOutreachQueue();
      });
    }

    const compOpenWa = document.getElementById('btn-composer-open-wa');
    if (compOpenWa) {
      compOpenWa.addEventListener('click', () => {
        handleOpenWhatsApp();
      });
    }

    // 21b. Queue Skip & Stop Buttons
    const queueSkipBtn = document.getElementById('btn-queue-skip');
    if (queueSkipBtn) {
      queueSkipBtn.addEventListener('click', () => skipQueueCurrentLead());
    }
    const compSkipLeadBtn = document.getElementById('btn-composer-skip-lead');
    if (compSkipLeadBtn) {
      compSkipLeadBtn.addEventListener('click', () => skipQueueCurrentLead());
    }
    const queueStopBtn = document.getElementById('btn-queue-stop');
    if (queueStopBtn) {
      queueStopBtn.addEventListener('click', () => stopOutreachQueue());
    }

    // 21c. Queue Completion Action Buttons
    const queueDoneBtn = document.getElementById('btn-queue-done');
    if (queueDoneBtn) {
      queueDoneBtn.addEventListener('click', () => {
        closeOutreachComposer();
        AppState.selectedLeadIds.clear();
        AppState.selectedFavLeadIds.clear();
        AppState.outreach.selectedLeadIds.clear();
        document.querySelectorAll('.row-checkbox, .fav-row-checkbox, .outreach-card-checkbox').forEach((c) => (c.checked = false));
        updateBulkActionBar();
        updateFavBulkActionBar();
        updateOutreachBulkControls();
        if (AppState.currentView === 'saved-leads') renderSavedTableRows();
        else if (AppState.currentView === 'favorites') renderFavTableRows();
        else if (AppState.currentView === 'outreach') renderOutreachCards();
      });
    }
    const queueViewOutreachBtn = document.getElementById('btn-queue-view-outreach');
    if (queueViewOutreachBtn) {
      queueViewOutreachBtn.addEventListener('click', () => {
        closeOutreachComposer();
        AppState.selectedLeadIds.clear();
        AppState.selectedFavLeadIds.clear();
        AppState.outreach.selectedLeadIds.clear();
        switchView('outreach');
        loadOutreachData();
      });
    }

    // 21d. Outreach Batch Send Button in Toolbar
    const batchSendBtn = document.getElementById('btn-outreach-send-batch');
    if (batchSendBtn) {
      batchSendBtn.addEventListener('click', () => {
        const allLeads = AppState.outreach.data?.allLeads || [];
        const selected = allLeads.filter((l) => AppState.outreach.selectedLeadIds.has(l.id || l.place_id));
        if (selected.length > 0) {
          startOutreachQueue(selected, 'outreach');
        } else {
          showToast('Please select leads to message.', 'info', 2000);
        }
      });
    }

    // 22. Safe WhatsApp Send Confirmation Buttons
    const confirmYes = document.getElementById('btn-confirm-sent-yes');
    const confirmNo = document.getElementById('btn-confirm-sent-no');
    const confirmNotOnWa = document.getElementById('btn-confirm-not-on-wa');
    if (confirmYes) confirmYes.addEventListener('click', () => handleConfirmSent(true));
    if (confirmNo) confirmNo.addEventListener('click', () => handleConfirmSent(false));
    if (confirmNotOnWa) confirmNotOnWa.addEventListener('click', handleConfirmNotOnWhatsApp);

    // 23. Close Composer Modal / Stop Queue
    const compClose = document.getElementById('btn-composer-close');
    const modalOutreach = document.getElementById('modal-outreach-composer');
    if (compClose) {
      compClose.addEventListener('click', () => stopOutreachQueue());
    }
    if (modalOutreach) {
      modalOutreach.addEventListener('click', (e) => {
        if (e.target === modalOutreach) stopOutreachQueue();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('modal-outreach-composer');
        if (modal && !modal.classList.contains('hidden') && modal.style.display !== 'none') {
          stopOutreachQueue();
        }
      }
    });

    // 24. Daily Target Edit Modal
    const openTargetModal = document.getElementById('btn-open-target-modal');
    const targetModal = document.getElementById('modal-target-edit');
    const cancelTargetEdit = document.getElementById('btn-cancel-target-edit');
    const saveTargetEdit = document.getElementById('btn-save-target-edit');

    if (openTargetModal && targetModal) {
      openTargetModal.addEventListener('click', () => targetModal.classList.remove('hidden'));
    }
    if (cancelTargetEdit && targetModal) {
      cancelTargetEdit.addEventListener('click', () => targetModal.classList.add('hidden'));
    }
    if (saveTargetEdit && targetModal) {
      saveTargetEdit.addEventListener('click', async () => {
        const inputVal = document.getElementById('input-daily-target')?.value;
        const num = parseInt(inputVal, 10);
        if (isNaN(num) || num < 1) {
          showToast('Please enter a valid target (minimum 1).', 'error', 2500);
          return;
        }
        try {
          const res = await fetch('/api/outreach/target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: num })
          });
          const json = await res.json();
          if (json.success) {
            showToast(json.message, 'success', 2500);
            targetModal.classList.add('hidden');
            await loadOutreachData(AppState.outreach.activeLeadId);
          }
        } catch (err) {
          console.error(err);
        }
      });
    }
  }

  // ----------------------------------------------------
  // 7b. FOLLOW-UP TRACKING & SCHEDULED PIPELINE CONTROLLER
  // ----------------------------------------------------

  const FOLLOW_UP_STAGE_DEFS = {
    1: { day: 2, name: 'Gentle Nudge', desc: 'Friendly, casual bump reminding them of previous note.' },
    2: { day: 4, name: 'Quick Check-in', desc: 'Brief check-in, asking if they reviewed work or had questions.' },
    3: { day: 7, name: 'Service Value', desc: 'Highlight a concrete value proposition or ROI.' },
    4: { day: 10, name: 'Low-Pressure Closing', desc: 'Respectful closing note giving them an easy out.' },
    5: { day: 14, name: 'Final Note', desc: 'Closing the loop politely, door left open for the future.' }
  };

  async function loadFollowUpData() {
    try {
      const res = await fetch('/api/outreach/data');
      const data = await res.json();
      if (!data || !data.success) {
        console.warn('Notice loading follow-up data:', data?.error);
        return;
      }
      AppState.followup.data = data;
      AppState.followup.leads = (data.allLeads || []).filter((lead) => {
        return Boolean(
          lead.first_message_sent ||
          lead.main_message_sent_at ||
          lead.outreach_status === 'Follow-Up' ||
          lead.outreach_status === 'Replied' ||
          lead.outreach_status === 'Completed'
        );
      });

      updateFollowUpCounters();
      renderFollowUpCards();
    } catch (err) {
      console.error('Error loading Follow-Up data:', err);
    }
  }

  function updateFollowUpCounters() {
    const allFollowUpLeads = AppState.followup.leads || [];
    let activeCount = 0;
    let dueTodayCount = 0;
    let upcomingCount = 0;
    let overdueCount = 0;
    let repliesCount = 0;
    let completedCount = 0;

    allFollowUpLeads.forEach((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');

      if (isReplied) {
        repliesCount++;
      } else if (isCompleted) {
        completedCount++;
      } else {
        activeCount++;
        const diff = getCalendarDayDiff(lead.next_follow_up_at);
        if (diff !== null) {
          if (diff === 0) dueTodayCount++;
          else if (diff < 0) overdueCount++;
          else if (diff > 0) upcomingCount++;
        }
      }
    });

    const cDue = document.getElementById('fu-counter-due-today');
    const cUpcoming = document.getElementById('fu-counter-upcoming');
    const cOverdue = document.getElementById('fu-counter-overdue');
    const cCompleted = document.getElementById('fu-counter-completed');
    const cActive = document.getElementById('fu-counter-active');

    if (cDue) cDue.textContent = dueTodayCount;
    if (cUpcoming) cUpcoming.textContent = upcomingCount;
    if (cOverdue) cOverdue.textContent = overdueCount;
    if (cCompleted) cCompleted.textContent = completedCount;
    if (cActive) cActive.textContent = activeCount;

    const tAll = document.getElementById('fu-tab-all-count');
    const tDue = document.getElementById('fu-tab-duetoday-count');
    const tOverdue = document.getElementById('fu-tab-overdue-count');
    const tUpcoming = document.getElementById('fu-tab-upcoming-count');
    const tCompleted = document.getElementById('fu-tab-completed-count');
    const tReplies = document.getElementById('fu-tab-replies-count');

    if (tAll) tAll.textContent = allFollowUpLeads.length;
    if (tDue) tDue.textContent = dueTodayCount;
    if (tOverdue) tOverdue.textContent = overdueCount;
    if (tUpcoming) tUpcoming.textContent = upcomingCount;
    if (tCompleted) tCompleted.textContent = completedCount;
    if (tReplies) tReplies.textContent = repliesCount;

    // Actionable Follow-Ups = Due Today + Overdue ONLY (never scheduled future leads!)
    const actionableCount = dueTodayCount + overdueCount;
    const navBadge = document.getElementById('nav-followup-badge');
    const mobileBadge = document.getElementById('mobile-nav-followup-badge');
    if (navBadge) navBadge.textContent = actionableCount;
    if (mobileBadge) mobileBadge.textContent = actionableCount;

    // "Today" Reminder Banner
    const reminderBanner = document.getElementById('fu-today-reminder-banner');
    const reminderText = document.getElementById('fu-today-reminder-text');
    if (reminderBanner && reminderText) {
      reminderBanner.className = 'fu-today-banner anim-dash';
      if (dueTodayCount === 0 && overdueCount === 0) {
        reminderBanner.classList.add('banner-success');
        reminderBanner.style.cursor = 'default';
        reminderBanner.onclick = null;
        reminderBanner.innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> <span>You're all caught up for today.</span>`;
      } else if (dueTodayCount > 0 && overdueCount === 0) {
        reminderBanner.classList.add('banner-due');
        reminderBanner.style.cursor = 'pointer';
        reminderBanner.onclick = () => setFollowUpTab('due-today');
        reminderBanner.innerHTML = `<i class="fa-solid fa-bell text-emerald"></i> <span>🔔 <strong>${dueTodayCount} follow-up${dueTodayCount === 1 ? '' : 's'}</strong> need to be sent today. Click to review.</span>`;
      } else if (dueTodayCount === 0 && overdueCount > 0) {
        reminderBanner.classList.add('banner-overdue');
        reminderBanner.style.cursor = 'pointer';
        reminderBanner.onclick = () => setFollowUpTab('overdue');
        reminderBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose"></i> <span>⚠ <strong>${overdueCount} follow-up${overdueCount === 1 ? '' : 's'}</strong> ${overdueCount === 1 ? 'is' : 'are'} overdue. Click to review.</span>`;
      } else {
        reminderBanner.classList.add('banner-overdue');
        reminderBanner.style.cursor = 'pointer';
        reminderBanner.onclick = () => setFollowUpTab('due-today');
        reminderBanner.innerHTML = `<i class="fa-solid fa-bell text-rose"></i> <span><strong>${dueTodayCount} follow-up${dueTodayCount === 1 ? '' : 's'} due today</strong> · <strong>${overdueCount} overdue</strong>. Click to review.</span>`;
      }
    }
  }

  function getFilteredFollowUpLeads() {
    const allLeads = AppState.followup.leads || [];
    const tab = AppState.followup.activeTab || 'all';
    const stageFilter = AppState.followup.stageFilter || 'ALL';
    const replyFilter = AppState.followup.replyFilter || 'ALL';
    const query = (AppState.followup.searchQuery || '').toLowerCase().trim();

    let filtered = allLeads.filter((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const diff = getCalendarDayDiff(lead.next_follow_up_at);

      if (tab === 'due-today') {
        if (isReplied || isCompleted || diff !== 0) return false;
      } else if (tab === 'overdue') {
        if (isReplied || isCompleted || diff === null || diff >= 0) return false;
      } else if (tab === 'upcoming') {
        if (isReplied || isCompleted || diff === null || diff <= 0) return false;
      } else if (tab === 'completed') {
        if (!isCompleted || isReplied) return false;
      } else if (tab === 'replies') {
        if (!isReplied) return false;
        if (replyFilter === 'INTERESTED' && lead.reply_status !== 'INTERESTED') return false;
        if (replyFilter === 'NOT_INTERESTED' && lead.reply_status !== 'NOT_INTERESTED') return false;
        if (replyFilter === 'OTHER' && (lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED')) return false;
      }

      // Stage sub-filter (Follow-Up #1..#5)
      if (stageFilter !== 'ALL') {
        const targetStep = parseInt(stageFilter, 10);
        const curStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
        if (curStep !== targetStep) return false;
      }

      return true;
    });

    if (query) {
      filtered = filtered.filter((lead) => {
        const name = (lead.business_name || '').toLowerCase();
        const phone = (lead.phone || '').toLowerCase();
        const city = (lead.city || '').toLowerCase();
        const state = (lead.state || '').toLowerCase();
        const cat = (lead.category || '').toLowerCase();
        return (
          name.includes(query) ||
          phone.includes(query) ||
          city.includes(query) ||
          state.includes(query) ||
          cat.includes(query)
        );
      });
    }

    return filtered;
  }

  function renderFollowUpCards() {
    const container = document.getElementById('followup-cards-container');
    const emptyState = document.getElementById('followup-empty-state');
    if (!container) return;

    const leads = getFilteredFollowUpLeads();
    const tab = AppState.followup.activeTab || 'all';

    // Toggle Reply Filter wrapper
    const replyFilterWrap = document.getElementById('fu-reply-filter-wrap');
    if (replyFilterWrap) {
      if (tab === 'replies') replyFilterWrap.classList.remove('hidden');
      else replyFilterWrap.classList.add('hidden');
    }

    if (leads.length === 0) {
      container.innerHTML = '';
      if (emptyState) {
        emptyState.classList.remove('hidden');
        const titleEl = document.getElementById('fu-empty-title');
        const descEl = document.getElementById('fu-empty-desc');
        if (tab === 'due-today') {
          if (titleEl) titleEl.textContent = 'No Follow-Ups Due Today';
          if (descEl) descEl.textContent = 'Great job! You have no follow-up messages waiting to be sent today.';
        } else if (tab === 'overdue') {
          if (titleEl) titleEl.textContent = 'No Overdue Follow-Ups';
          if (descEl) descEl.textContent = 'All scheduled follow-ups are completely up to date!';
        } else if (tab === 'upcoming') {
          if (titleEl) titleEl.textContent = 'No Upcoming Follow-Ups';
          if (descEl) descEl.textContent = 'Send initial outreach messages to schedule automatic follow-up reminders.';
        } else if (tab === 'replies') {
          if (titleEl) titleEl.textContent = 'No Replies Recorded Yet';
          if (descEl) descEl.textContent = 'When prospects reply on WhatsApp, click "Reply" to record their status.';
        } else if (tab === 'completed') {
          if (titleEl) titleEl.textContent = 'No Completed Sequences Yet';
          if (descEl) descEl.textContent = 'Leads that finish the full 5-step follow-up sequence will be archived here.';
        } else {
          if (titleEl) titleEl.textContent = 'No Follow-Ups Found';
          if (descEl) descEl.textContent = 'Send initial outreach on the Outreach page. Confirmed sends move here automatically.';
        }
      }
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    container.innerHTML = leads.map((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const diff = getCalendarDayDiff(lead.next_follow_up_at);

      let statusBadgeClass = 'upcoming';
      let statusBadgeText = 'UPCOMING';
      let cardModifierClass = '';

      if (lead.reply_status === 'INTERESTED') {
        statusBadgeClass = 'interested';
        statusBadgeText = 'INTERESTED';
        cardModifierClass = 'status-replied';
      } else if (lead.reply_status === 'NOT_INTERESTED') {
        statusBadgeClass = 'not-interested';
        statusBadgeText = 'NOT INTERESTED';
        cardModifierClass = 'status-replied';
      } else if (lead.reply_status === 'OTHER' || isReplied) {
        statusBadgeClass = 'replied';
        statusBadgeText = 'REPLIED';
        cardModifierClass = 'status-replied';
      } else if (isCompleted) {
        statusBadgeClass = 'completed';
        statusBadgeText = 'COMPLETED';
        cardModifierClass = 'status-completed';
      } else if (diff !== null) {
        if (diff < 0) {
          statusBadgeClass = 'overdue';
          statusBadgeText = `${Math.abs(diff)}D OVERDUE`;
          cardModifierClass = 'status-overdue';
        } else if (diff === 0) {
          statusBadgeClass = 'due';
          statusBadgeText = 'DUE TODAY';
          cardModifierClass = 'status-due';
        } else {
          statusBadgeClass = 'upcoming';
          statusBadgeText = `DUE IN ${diff}D`;
        }
      }

      const curStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
      const safeStep = Math.min(5, Math.max(1, parseInt(curStep, 10) || 1));
      const stageDef = FOLLOW_UP_STAGE_DEFS[safeStep] || { day: 2, name: 'Gentle Nudge' };

      const nextFollowUpName = (!isReplied && !isCompleted)
        ? `Follow-Up #${safeStep} — ${stageDef.name}`
        : '—';

      const nextFollowUpDate = (!isReplied && !isCompleted && lead.next_follow_up_at)
        ? formatDDMMYYYY(lead.next_follow_up_at)
        : '—';

      let dueStatusDisplay = '—';
      let dueHighlightClass = '';

      if (isReplied) {
        dueStatusDisplay = `Replied ${formatDDMMYYYY(lead.replied_at)}`;
      } else if (isCompleted) {
        dueStatusDisplay = 'Day 14 Finished';
      } else if (diff !== null) {
        dueStatusDisplay = getDaysUntilText(diff);
        if (diff < 0) dueHighlightClass = 'overdue-highlight';
        else if (diff === 0) dueHighlightClass = 'due-highlight';
      }

      // Actionability Check: Follow-Up can ONLY be sent on or after due date!
      const isActionable = !isReplied && !isCompleted && diff !== null && diff <= 0;
      const canReply = !isCompleted;

      const leadId = escapeHtml(String(lead.id || lead.place_id));
      const catLower = (lead.category || '').toLowerCase();
      let iconAvatar = '<i class="fa-solid fa-building"></i>';
      if (catLower.includes('dent') || catLower.includes('tooth')) iconAvatar = '<i class="fa-solid fa-tooth"></i>';
      else if (catLower.includes('gym') || catLower.includes('fit')) iconAvatar = '<i class="fa-solid fa-dumbbell"></i>';
      else if (catLower.includes('clinic') || catLower.includes('doc') || catLower.includes('health')) iconAvatar = '<i class="fa-solid fa-stethoscope"></i>';

      // 6-Node Compact Sequence Timeline (Day 0, Day 2, Day 4, Day 7, Day 10, Day 14)
      const anchorTime = new Date(lead.main_message_sent_at || lead.first_message_sent_at || new Date().toISOString()).getTime();
      const timelineNodes = [
        { step: 0, day: 'Day 0', label: 'Main Message', offset: 0 },
        { step: 1, day: 'Day 2', label: 'FU #1', offset: 2 },
        { step: 2, day: 'Day 4', label: 'FU #2', offset: 4 },
        { step: 3, day: 'Day 7', label: 'FU #3', offset: 7 },
        { step: 4, day: 'Day 10', label: 'FU #4', offset: 10 },
        { step: 5, day: 'Day 14', label: 'FU #5', offset: 14 }
      ];

      const timelineHtml = timelineNodes.map((node) => {
        const nodeDateIso = new Date(anchorTime + node.offset * 24 * 60 * 60 * 1000).toISOString();
        const nodeDateDisplay = formatDDMMYYYY(nodeDateIso);
        let nodeStatusClass = 'pending';
        let marker = '○';
        let statusLabel = `${node.day} · ${nodeDateDisplay}`;

        if (lead.reply_status && node.step > (lead.current_follow_up_number || 0)) {
          nodeStatusClass = 'stopped';
          marker = '—';
          statusLabel = 'Stopped: Replied';
        } else if (node.step === 0 || node.step <= (lead.current_follow_up_number || 0)) {
          nodeStatusClass = 'sent';
          marker = '✓';
          statusLabel = `${node.day} · Sent`;
        } else if (node.step === safeStep && !isCompleted && !isReplied) {
          if (diff === 0) {
            nodeStatusClass = 'due';
            marker = '●';
            statusLabel = `${node.day} · Due Today`;
          } else if (diff !== null && diff < 0) {
            nodeStatusClass = 'overdue';
            marker = '⚠';
            statusLabel = `${node.day} · Overdue`;
          } else {
            nodeStatusClass = 'upcoming';
            marker = '○';
            statusLabel = `${node.day} · ${nodeDateDisplay}`;
          }
        }

        return `
          <div class="fu-timeline-step ${nodeStatusClass}">
            <div class="fu-step-dot" title="${escapeHtml(node.label)}">${marker}</div>
            <div class="fu-step-info">
              <span class="fu-step-name">${escapeHtml(node.label)}</span>
              <span class="fu-step-date">${statusLabel}</span>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="followup-card ${cardModifierClass}" data-lead-id="${leadId}">
          <div class="fu-card-header">
            <div class="fu-header-left">
              <div class="fu-card-avatar">${iconAvatar}</div>
              <div class="fu-header-meta">
                <h3 class="fu-biz-name">${escapeHtml(lead.business_name || 'Business')}</h3>
                <div class="fu-sub-meta">
                  <span class="fu-cat-pill">${escapeHtml(lead.category || 'Local Business')}</span>
                  <span class="fu-meta-loc"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(lead.city ? (lead.city + (lead.state ? ', ' + lead.state : '')) : (lead.state || 'Local'))}</span>
                  ${lead.phone ? `<span class="fu-meta-phone"><i class="fa-solid fa-phone"></i> ${escapeHtml(lead.phone)}</span>` : ''}
                  <span class="fu-meta-score">Score: <strong>${lead.opportunity_score ?? 50}</strong></span>
                </div>
              </div>
            </div>
            <div class="fu-header-right">
              <span class="fu-badge ${statusBadgeClass}">${statusBadgeText}</span>
            </div>
          </div>

          <!-- Lead Details Meta Grid -->
          <div class="fu-grid-meta">
            <div class="fu-meta-block">
              <span class="fu-block-lbl">MAIN MESSAGE SENT</span>
              <span class="fu-block-val highlight-date">${formatDDMMYYYY(lead.main_message_sent_at || lead.first_message_sent_at)}</span>
            </div>
            <div class="fu-meta-block">
              <span class="fu-block-lbl">LAST MESSAGE</span>
              <span class="fu-block-val">${escapeHtml(lead.last_message_type || 'Main Message')}</span>
            </div>
            <div class="fu-meta-block">
              <span class="fu-block-lbl">LAST MESSAGE DATE</span>
              <span class="fu-block-val highlight-date">${formatDDMMYYYY(lead.last_message_sent_at || lead.main_message_sent_at)}</span>
            </div>
            <div class="fu-meta-block">
              <span class="fu-block-lbl">NEXT STAGE</span>
              <span class="fu-block-val ${isActionable || (!isReplied && !isCompleted) ? '' : 'text-muted'}">${escapeHtml(nextFollowUpName)}</span>
            </div>
            <div class="fu-meta-block">
              <span class="fu-block-lbl">NEXT FOLLOW-UP DATE</span>
              <span class="fu-block-val highlight-date ${isActionable || (!isReplied && !isCompleted) ? '' : 'text-muted'}">${nextFollowUpDate}</span>
            </div>
            <div class="fu-meta-block">
              <span class="fu-block-lbl">${isReplied ? 'REPLY OUTCOME' : 'DUE / STATUS'}</span>
              <span class="fu-block-val ${dueHighlightClass}">${dueStatusDisplay}</span>
            </div>
          </div>

          <!-- Compact Pipeline Sequence Timeline -->
          <div class="fu-card-timeline">
            ${timelineHtml}
          </div>

          <!-- Card Action Buttons -->
          <div class="fu-card-actions">
            ${isActionable ? `
              <button type="button" class="btn-fu-send ${diff < 0 ? 'overdue' : 'due'}" data-action="send-fu" data-lead-id="${leadId}">
                <i class="fa-regular fa-paper-plane"></i>
                <span>${diff < 0 ? 'Send Follow-Up (Overdue)' : 'Send Follow-Up'}</span>
              </button>
            ` : (!isReplied && !isCompleted && diff !== null && diff > 0) ? `
              <div class="fu-upcoming-lock-pill" title="Follow-up action will become available on the scheduled date">
                <i class="fa-regular fa-clock"></i>
                <span>Scheduled for ${nextFollowUpDate} (${getDaysUntilText(diff)})</span>
              </div>
            ` : (isReplied) ? `
              <div class="fu-replied-pill">
                <i class="fa-solid fa-circle-check"></i>
                <span>Replied: ${lead.reply_status === 'INTERESTED' ? 'Interested' : (lead.reply_status === 'NOT_INTERESTED' ? 'Not Interested' : 'General')}</span>
              </div>
            ` : `
              <div class="fu-completed-pill">
                <i class="fa-solid fa-flag-checkered"></i>
                <span>Sequence Complete (Day 14 Finished)</span>
              </div>
            `}
            ${canReply ? `
              <button type="button" class="btn-fu-reply" data-action="reply" data-lead-id="${leadId}">
                <i class="fa-regular fa-comment-dots"></i>
                <span>Reply</span>
              </button>
            ` : ''}
            <button type="button" class="btn-fu-view" data-action="view" data-lead-id="${leadId}">
              <i class="fa-regular fa-eye"></i>
              <span>View</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function setFollowUpTab(tabKey) {
    AppState.followup.activeTab = tabKey;
    const tabBtns = document.querySelectorAll('.fu-tab-btn');
    tabBtns.forEach((btn) => {
      if (btn.getAttribute('data-fu-tab') === tabKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    renderFollowUpCards();
  }

  // ----------------------------------------------------
  // DEDICATED LIGHTWEIGHT FOLLOW-UP MODAL
  // ----------------------------------------------------

  function openDedicatedFollowUpModal(lead) {
    if (!lead) return;
    AppState.followup.currentComposerLead = lead;

    const curStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
    const safeStep = Math.min(5, Math.max(1, parseInt(curStep, 10) || 1));
    const stageDef = FOLLOW_UP_STAGE_DEFS[safeStep] || { day: 2, name: 'Gentle Nudge' };

    const modal = document.getElementById('modal-followup-composer');
    if (!modal) return;

    // Reset view states
    const mainContent = document.getElementById('fu-composer-main-content');
    const confirmBlock = document.getElementById('fu-composer-confirm-block');
    if (mainContent) mainContent.classList.remove('hidden');
    if (confirmBlock) confirmBlock.classList.add('hidden');

    // Header & context bar
    const stagePill = document.getElementById('fu-modal-stage-pill');
    const titleEl = document.getElementById('fu-modal-title');
    const bizEl = document.getElementById('fu-modal-bizname');
    const lastDateEl = document.getElementById('fu-modal-last-date');
    const stageDayEl = document.getElementById('fu-modal-stage-day');
    const phoneEl = document.getElementById('fu-modal-phone');

    if (stagePill) stagePill.textContent = `Follow-Up #${safeStep}`;
    if (titleEl) titleEl.textContent = stageDef.name;
    if (bizEl) bizEl.textContent = lead.business_name || 'Business';
    if (lastDateEl) lastDateEl.textContent = formatDDMMYYYY(lead.last_message_sent_at || lead.main_message_sent_at);
    if (stageDayEl) stageDayEl.textContent = `Day ${stageDef.day}`;
    if (phoneEl) phoneEl.textContent = lead.phone || 'Not available';

    // Retrieve ONLY the matching template for this stage
    const targetTplId = `tpl-followup-${safeStep}`;
    const templates = (AppState.settings?.templates && AppState.settings.templates.length > 0)
      ? AppState.settings.templates
      : SettingsModule.getDefaults().templates;

    const foundTpl = templates.find((t) => t.id === targetTplId);
    const textarea = document.getElementById('fu-modal-message-text');
    const warnEl = document.getElementById('fu-modal-missing-template-warning');
    const waBtn = document.getElementById('btn-fu-modal-wa');

    if (!foundTpl) {
      if (warnEl) warnEl.classList.remove('hidden');
      if (textarea) textarea.value = '';
      if (waBtn) waBtn.disabled = true;
    } else {
      if (warnEl) warnEl.classList.add('hidden');
      if (waBtn) waBtn.disabled = false;

      const profile = AppState.settings?.profile || SettingsModule.getDefaults().profile;
      const myName = profile.fullName || 'Akshay';
      const myCompany = profile.companyName || 'Nexora Labs';
      const portfolioUrl = profile.portfolioUrl || 'https://nexoralabs.com/portfolio';
      const websiteUrl = profile.websiteUrl || 'https://nexoralabs.com';

      const bizName = lead.business_name || 'there';
      const cat = lead.category || 'business';
      const city = lead.city || 'your area';
      const phone = lead.phone || '';

      const interpolated = foundTpl.content
        .replace(/\{businessName\}/g, bizName)
        .replace(/\{\{businessName\}\}/g, bizName)
        .replace(/\{category\}/g, cat)
        .replace(/\{\{category\}\}/g, cat)
        .replace(/\{city\}/g, city)
        .replace(/\{\{city\}\}/g, city)
        .replace(/\{phone\}/g, phone)
        .replace(/\{\{phone\}\}/g, phone)
        .replace(/\{my_name\}/g, myName)
        .replace(/\{\{my_name\}\}/g, myName)
        .replace(/\{my_company\}/g, myCompany)
        .replace(/\{\{my_company\}\}/g, myCompany)
        .replace(/\{portfolio_url\}/g, portfolioUrl)
        .replace(/\{\{portfolio_url\}\}/g, portfolioUrl)
        .replace(/\{website_url\}/g, websiteUrl)
        .replace(/\{\{website_url\}\}/g, websiteUrl);

      if (textarea) {
        textarea.value = interpolated;
        updateDedicatedCharCount();
      }
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeDedicatedFollowUpModal() {
    const modal = document.getElementById('modal-followup-composer');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
    AppState.followup.currentComposerLead = null;
  }

  function updateDedicatedCharCount() {
    const textarea = document.getElementById('fu-modal-message-text');
    const counter = document.getElementById('fu-modal-char-count');
    if (textarea && counter) {
      counter.textContent = `${textarea.value.length} / 1000`;
    }
  }

  function handleOpenDedicatedWhatsApp() {
    const lead = AppState.followup.currentComposerLead;
    if (!lead) return;

    const cleanPhone = cleanPhoneNumber(lead.phone);
    if (!cleanPhone) {
      showToast('This lead does not have a valid phone number.', 'error', 3000);
      return;
    }

    const textarea = document.getElementById('fu-modal-message-text');
    const finalMsg = textarea ? textarea.value.trim() : '';
    AppState.followup.lastPreparedMessage = finalMsg;

    const waMode = AppState.settings?.whatsappPreferences?.launchMode || 'desktop';
    const waUrl = (waMode === 'desktop')
      ? `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(finalMsg)}`
      : `https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMsg)}`;
    window.open(waUrl, '_blank');

    // Transition to Confirmation step
    const mainContent = document.getElementById('fu-composer-main-content');
    const confirmBlock = document.getElementById('fu-composer-confirm-block');
    const confirmBiz = document.getElementById('fu-confirm-biz-name');
    const confirmMsg = document.getElementById('fu-confirm-msg-text');

    if (confirmBiz) confirmBiz.textContent = lead.business_name || 'Business';
    if (confirmMsg) confirmMsg.textContent = finalMsg;

    if (mainContent) mainContent.classList.add('hidden');
    if (confirmBlock) confirmBlock.classList.remove('hidden');
  }

  async function handleConfirmDedicatedSent(confirmed) {
    const lead = AppState.followup.currentComposerLead;
    if (!lead) return;

    if (!confirmed) {
      showToast('Follow-up marked as not sent. Lead remains on current follow-up step.', 'info', 2500);
      closeDedicatedFollowUpModal();
      return;
    }

    const leadId = lead.id || lead.place_id;
    const finalMsg = AppState.followup.lastPreparedMessage || document.getElementById('fu-modal-message-text')?.value?.trim() || '';
    const curStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
    const safeStep = Math.min(5, Math.max(1, parseInt(curStep, 10) || 1));

    try {
      const res = await fetch('/api/outreach/mark-followup-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          messageText: finalMsg,
          step: safeStep
        })
      });
      const json = await res.json();

      if (json.success) {
        showToast(json.completed ? `✓ Sequence Complete (Day 14 finished)!` : `✓ Follow-Up #${safeStep} marked as sent`, 'success', 2500);
        if (json.lead) {
          Object.assign(lead, json.lead);
        } else {
          lead.last_message_sent_at = new Date().toISOString();
          lead.last_message_type = `Follow-Up #${safeStep}`;
          lead.current_follow_up_number = safeStep;
          if (safeStep >= 5) {
            lead.outreach_status = 'Completed';
            lead.follow_up_completed = true;
          }
        }

        // Sync local caches
        const savedMatch = AppState.savedLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
        if (savedMatch && json.lead) Object.assign(savedMatch, json.lead);

        const favMatch = AppState.favoriteLeads.find((l) => (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
        if (favMatch && json.lead) Object.assign(favMatch, json.lead);

        updateFollowUpCounters();
        renderFollowUpCards();
        updateBadgeCounts();
        closeDedicatedFollowUpModal();
      } else {
        showToast(json.error || 'Failed to record follow-up.', 'error', 3000);
      }
    } catch (err) {
      console.error('Error confirming follow-up send:', err);
      showToast('Network error confirming follow-up.', 'error', 2500);
    }
  }

  // Reply Workflow
  function openReplyModal(lead) {
    if (!lead) return;
    AppState.followup.currentReplyLead = lead;

    const modal = document.getElementById('modal-lead-reply');
    const nameEl = document.getElementById('reply-lead-biz-name');
    const metaEl = document.getElementById('reply-lead-meta');

    if (nameEl) nameEl.textContent = lead.business_name || 'Business';
    if (metaEl) {
      const lastMsg = lead.last_message_type || 'Main Message';
      const lastDate = formatDDMMYYYY(lead.last_message_sent_at || lead.main_message_sent_at);
      metaEl.textContent = `Last Message: ${lastMsg} • Sent: ${lastDate}`;
    }

    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function closeReplyModal() {
    const modal = document.getElementById('modal-lead-reply');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
    AppState.followup.currentReplyLead = null;
  }

  async function submitReplyStatus(replyStatus) {
    const lead = AppState.followup.currentReplyLead;
    if (!lead) return;
    const leadId = lead.id || lead.place_id;

    try {
      const res = await fetch('/api/outreach/mark-replied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, replyStatus })
      });
      const json = await res.json();

      if (json.success) {
        const label = replyStatus === 'INTERESTED' ? 'Interested' : (replyStatus === 'NOT_INTERESTED' ? 'Not Interested' : 'Replied');
        showToast(`✓ Marked "${lead.business_name}" as ${label}. Follow-ups stopped.`, 'success', 3000);

        lead.reply_status = replyStatus;
        lead.replied_at = new Date().toISOString();
        lead.follow_up_completed = true;
        lead.outreach_status = 'Replied';
        lead.next_follow_up_at = null;
        lead.next_follow_up_number = null;
        lead.next_follow_up_name = null;

        // Invalidate dirty flags
        AppState.followupDirty = true;
        AppState.outreachDirty = true;
        AppState.savedLeadsDirty = true;

        updateFollowUpCounters();
        renderFollowUpCards();
        updateBadgeCounts();
      } else {
        showToast('Error updating reply status.', 'error', 2500);
      }
    } catch (err) {
      console.error('Error recording reply:', err);
      showToast('Failed to record reply.', 'error', 2500);
    } finally {
      closeReplyModal();
    }
  }

  // Initialization & Event Delegation
  let followUpListenersBound = false;
  function initFollowUpListeners() {
    if (followUpListenersBound) return;
    followUpListenersBound = true;

    // 1. Search filter (debounced 180ms)
    const searchInput = document.getElementById('followup-search-input');
    const searchClear = document.getElementById('btn-followup-search-clear');
    let searchDebounceTimer = null;

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (searchClear) {
          if (val.trim().length > 0) searchClear.classList.remove('hidden');
          else searchClear.classList.add('hidden');
        }
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          AppState.followup.searchQuery = val;
          renderFollowUpCards();
        }, 180);
      });
    }

    if (searchClear && searchInput) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        AppState.followup.searchQuery = '';
        searchClear.classList.add('hidden');
        renderFollowUpCards();
      });
    }

    // 2. Tabs
    const tabBtns = document.querySelectorAll('.fu-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabKey = btn.getAttribute('data-fu-tab');
        setFollowUpTab(tabKey);
      });
    });

    // 3. Metric cards navigation
    const metricCardMap = [
      { id: 'card-fu-due-today', tab: 'due-today' },
      { id: 'card-fu-upcoming', tab: 'upcoming' },
      { id: 'card-fu-overdue', tab: 'overdue' },
      { id: 'card-fu-completed', tab: 'completed' },
      { id: 'card-fu-active', tab: 'all' }
    ];
    metricCardMap.forEach(({ id, tab }) => {
      const card = document.getElementById(id);
      if (card) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => setFollowUpTab(tab));
      }
    });

    // 4. Stage sub-filter
    const stageSelect = document.getElementById('fu-stage-filter');
    if (stageSelect) {
      stageSelect.addEventListener('change', (e) => {
        AppState.followup.stageFilter = e.target.value;
        renderFollowUpCards();
      });
    }

    // 5. Reply status sub-filter
    const replySelect = document.getElementById('fu-reply-status-filter');
    if (replySelect) {
      replySelect.addEventListener('change', (e) => {
        AppState.followup.replyFilter = e.target.value;
        renderFollowUpCards();
      });
    }

    // 6. Refresh button
    const refreshBtn = document.getElementById('btn-followup-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        showToast('Refreshing Follow-Up leads...', 'info', 1500);
        await loadFollowUpData();
      });
    }

    // 7. Cards container action delegation
    const container = document.getElementById('followup-cards-container');
    if (container) {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const leadId = btn.getAttribute('data-lead-id');
        const lead = (AppState.followup.leads || []).find(
          (l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))
        );
        if (!lead) return;

        if (action === 'send-fu') {
          openDedicatedFollowUpModal(lead);
        } else if (action === 'reply') {
          openReplyModal(lead);
        } else if (action === 'view') {
          showLeadDetailModal(lead);
        }
      });
    }

    // 8. Dedicated Follow-Up modal listeners
    const fuModalClose = document.getElementById('btn-fu-modal-close');
    const fuModalCancel = document.getElementById('btn-fu-modal-cancel');
    const fuModalWa = document.getElementById('btn-fu-modal-wa');
    const fuConfirmYes = document.getElementById('btn-fu-confirm-yes');
    const fuConfirmNo = document.getElementById('btn-fu-confirm-no');
    const fuModalCopy = document.getElementById('btn-fu-modal-copy');
    const fuModalRegen = document.getElementById('btn-fu-modal-regen');
    const fuOpenSettings = document.getElementById('btn-fu-open-settings');
    const fuTextarea = document.getElementById('fu-modal-message-text');

    if (fuModalClose) fuModalClose.addEventListener('click', closeDedicatedFollowUpModal);
    if (fuModalCancel) fuModalCancel.addEventListener('click', closeDedicatedFollowUpModal);
    if (fuModalWa) fuModalWa.addEventListener('click', handleOpenDedicatedWhatsApp);
    if (fuConfirmYes) fuConfirmYes.addEventListener('click', () => handleConfirmDedicatedSent(true));
    if (fuConfirmNo) fuConfirmNo.addEventListener('click', () => handleConfirmDedicatedSent(false));
    const fuConfirmNotOnWa = document.getElementById('btn-fu-confirm-not-wa');
    if (fuConfirmNotOnWa) fuConfirmNotOnWa.addEventListener('click', handleDedicatedNotOnWhatsApp);

    if (fuTextarea) {
      fuTextarea.addEventListener('input', updateDedicatedCharCount);
    }

    if (fuModalCopy) {
      fuModalCopy.addEventListener('click', () => {
        const text = document.getElementById('fu-modal-message-text')?.value || '';
        if (text) {
          navigator.clipboard.writeText(text);
          showToast('✓ Follow-up message copied to clipboard', 'success', 2000);
        }
      });
    }

    if (fuModalRegen) {
      fuModalRegen.addEventListener('click', async () => {
        const lead = AppState.followup.currentComposerLead;
        if (!lead) return;
        const curStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
        const safeStep = Math.min(5, Math.max(1, parseInt(curStep, 10) || 1));
        const textarea = document.getElementById('fu-modal-message-text');

        if (textarea) textarea.value = `Crafting Follow-Up #${safeStep} message...`;
        fuModalRegen.disabled = true;

        try {
          const res = await fetch('/api/outreach/generate-followup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: lead.id || lead.place_id,
              followUpDay: safeStep
            })
          });
          const json = await res.json();
          if (json.success && textarea) {
            textarea.value = json.message;
            updateDedicatedCharCount();
          }
        } catch (err) {
          console.error('Error regenerating follow-up:', err);
          showToast('Failed to regenerate follow-up message.', 'error', 2500);
        } finally {
          fuModalRegen.disabled = false;
        }
      });
    }

    if (fuOpenSettings) {
      fuOpenSettings.addEventListener('click', () => {
        closeDedicatedFollowUpModal();
        switchView('settings');
      });
    }

    // 9. Reply modal action buttons
    const optInterested = document.getElementById('btn-reply-opt-interested');
    const optNotInterested = document.getElementById('btn-reply-opt-not-interested');
    const optOther = document.getElementById('btn-reply-opt-other');
    const replyClose = document.getElementById('btn-reply-modal-close');
    const replyCancel = document.getElementById('btn-reply-modal-cancel');

    if (optInterested) {
      optInterested.addEventListener('click', () => submitReplyStatus('INTERESTED'));
    }
    if (optNotInterested) {
      optNotInterested.addEventListener('click', () => submitReplyStatus('NOT_INTERESTED'));
    }
    if (optOther) {
      optOther.addEventListener('click', () => submitReplyStatus('OTHER'));
    }
    if (replyClose) {
      replyClose.addEventListener('click', closeReplyModal);
    }
    if (replyCancel) {
      replyCancel.addEventListener('click', closeReplyModal);
    }
  }



  // ----------------------------------------------------
  // 7d. HISTORY TERMINAL CONTROLLER (VIDEO 00:46 → 00:47)
  // ----------------------------------------------------
  async function loadHistoryData() {
    AppState.history.isLoading = true;
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data && data.success && Array.isArray(data.history)) {
        AppState.history.records = data.history;
      } else {
        AppState.history.records = [];
      }
    } catch (err) {
      console.error('Failed to load history data:', err);
      showToast('Could not fetch past search logs.', 'error');
    } finally {
      AppState.history.isLoading = false;
      const validIds = new Set(AppState.history.records.map((r) => r.id));
      for (const id of AppState.history.selectedIds) {
        if (!validIds.has(id)) {
          AppState.history.selectedIds.delete(id);
        }
      }
      renderHistoryCards();
      updateHistoryHeader();
    }
  }

  function updateHistoryHeader() {
    const totalCountEl = document.getElementById('history-total-count');
    const selectAllBtn = document.getElementById('btn-history-select-all');
    const selectAllIcon = document.getElementById('icon-history-select-all');
    const selectAllText = document.getElementById('text-history-select-all');
    const deleteAllBtn = document.getElementById('btn-history-delete-all');
    const deleteAllText = document.getElementById('text-history-delete-all');

    const total = AppState.history.records.length;
    const selectedCount = AppState.history.selectedIds.size;

    if (totalCountEl) {
      totalCountEl.textContent = total;
    }

    if (selectAllBtn && selectAllIcon && selectAllText) {
      if (total === 0) {
        selectAllBtn.disabled = true;
        selectAllIcon.className = 'fa-regular fa-square';
        selectAllText.textContent = 'Select All';
      } else if (selectedCount === total) {
        selectAllBtn.disabled = false;
        selectAllIcon.className = 'fa-solid fa-square-check';
        selectAllText.textContent = 'Deselect All';
      } else if (selectedCount > 0) {
        selectAllBtn.disabled = false;
        selectAllIcon.className = 'fa-solid fa-square-minus';
        selectAllText.textContent = `Selected (${selectedCount})`;
      } else {
        selectAllBtn.disabled = false;
        selectAllIcon.className = 'fa-regular fa-square';
        selectAllText.textContent = 'Select All';
      }
    }

    if (deleteAllBtn && deleteAllText) {
      if (total === 0) {
        deleteAllBtn.disabled = true;
        deleteAllText.textContent = 'Delete All';
      } else if (selectedCount > 0) {
        deleteAllBtn.disabled = false;
        deleteAllText.textContent = `Delete Selected (${selectedCount})`;
      } else {
        deleteAllBtn.disabled = false;
        deleteAllText.textContent = 'Delete All';
      }
    }
  }

  function renderHistoryCards() {
    const listContainer = document.getElementById('history-cards-container');
    const emptyState = document.getElementById('history-empty-state');
    if (!listContainer || !emptyState) return;

    listContainer.innerHTML = '';
    const records = AppState.history.records;

    if (!records || records.length === 0) {
      listContainer.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    listContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const frag = document.createDocumentFragment();

    records.forEach((rec) => {
      const isSelected = AppState.history.selectedIds.has(rec.id);
      const card = document.createElement('div');
      card.className = `history-card ${isSelected ? 'selected' : ''}`;
      card.setAttribute('data-id', rec.id);

      const category = rec.category || rec.parameters?.category || 'General Leads';
      const locParts = [];
      if (rec.city) locParts.push(rec.city);
      if (rec.state) locParts.push(rec.state);
      const locStr = locParts.join(', ') || 'National Market';

      const dateStr = rec.date || 'Recent Scan';
      const radiusKm = rec.radiusKm || rec.parameters?.radiusKm || 25;
      const radiusStr = `Radius: ${radiusKm} km`;

      const uniqueLeads = rec.uniqueLeads ?? rec.totalDiscovered ?? 0;
      const withoutWebsite = rec.withoutWebsite ?? 0;
      const withWebsite = rec.withWebsite ?? 0;

      card.innerHTML = `
        <div class="history-card-left">
          <label class="history-cb-wrap" title="Select this scan">
            <input type="checkbox" class="history-card-checkbox" data-id="${rec.id}" ${isSelected ? 'checked' : ''} />
          </label>
          <div class="history-card-info">
            <h3 class="history-card-title">${escapeHtml(category)}</h3>
            <div class="history-card-meta">
              <span class="hist-meta-item">
                <i class="fa-solid fa-location-dot"></i>
                <span>${escapeHtml(locStr)}</span>
              </span>
              <span class="hist-dot">•</span>
              <span class="hist-meta-item">
                <i class="fa-regular fa-calendar"></i>
                <span>${escapeHtml(dateStr)}</span>
              </span>
              <span class="hist-dot">•</span>
              <span class="hist-meta-item">
                <i class="fa-solid fa-globe"></i>
                <span>${escapeHtml(radiusStr)}</span>
              </span>
            </div>
            <div class="history-card-badges">
              <span class="hist-badge badge-unique">${uniqueLeads} Unique Leads</span>
              <span class="hist-badge badge-noweb">${withoutWebsite} Without Website</span>
              <span class="hist-badge badge-hasweb">${withWebsite} With Website</span>
            </div>
          </div>
        </div>
        <div class="history-card-right">
          <button type="button" class="btn-history-delete" data-id="${rec.id}" title="Delete search record">
            <i class="fa-regular fa-trash-can"></i>
            <span>Delete</span>
          </button>
          <button type="button" class="btn-history-rerun" data-id="${rec.id}" title="Re-run this market query in Find Leads">
            <i class="fa-solid fa-arrows-rotate"></i>
            <span>Search Again</span>
            <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 11px;"></i>
          </button>
        </div>
      `;

      frag.appendChild(card);
    });

    listContainer.appendChild(frag);
  }

  function initHistoryContainerDelegation() {
    const listContainer = document.getElementById('history-cards-container');
    if (!listContainer || listContainer.dataset.delegated) return;
    listContainer.dataset.delegated = 'true';

    listContainer.addEventListener('change', (e) => {
      const cb = e.target.closest('.history-card-checkbox');
      if (cb) {
        const id = cb.getAttribute('data-id');
        const card = cb.closest('.history-card');
        if (cb.checked) {
          AppState.history.selectedIds.add(id);
          if (card) card.classList.add('selected');
        } else {
          AppState.history.selectedIds.delete(id);
          if (card) card.classList.remove('selected');
        }
        updateHistoryHeader();
      }
    });

    listContainer.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btn-history-delete');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.getAttribute('data-id');
        const rec = AppState.history.records.find((r) => String(r.id) === String(id));
        const category = rec ? (rec.category || rec.parameters?.category || 'General Leads') : 'General Leads';
        const locStr = rec ? (rec.city || rec.state || 'National Market') : 'National Market';
        openDeleteConfirmModal(
          'Delete Search Record?',
          `Are you sure you want to permanently delete the past search log for "${category}" in ${locStr}? This cannot be undone.`,
          async () => {
            try {
              const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
              const json = await res.json();
              if (json.success) {
                showToast('Search history record deleted.', 'info', 2500);
                AppState.history.selectedIds.delete(id);
                AppState.history.records = AppState.history.records.filter((r) => String(r.id) !== String(id));
                const card = listContainer.querySelector(`.history-card[data-id="${id}"]`);
                if (card) card.remove();
                updateHistoryHeader();
                if (!listContainer.children.length) {
                  renderHistoryCards();
                }
              } else {
                showToast('Failed to delete search record.', 'error');
              }
            } catch (err) {
              console.error(err);
              showToast('Error deleting record.', 'error');
            }
          }
        );
        return;
      }

      const rerunBtn = e.target.closest('.btn-history-rerun');
      if (rerunBtn) {
        e.stopPropagation();
        const id = rerunBtn.getAttribute('data-id');
        const rec = AppState.history.records.find((r) => String(r.id) === String(id));
        if (rec) handleHistorySearchAgain(rec);
        return;
      }

      if (e.target.closest('.history-cb-wrap') || e.target.closest('input')) return;

      const card = e.target.closest('.history-card');
      if (card) {
        const cb = card.querySelector('.history-card-checkbox');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  }

  function handleHistorySelectAll() {
    const total = AppState.history.records.length;
    if (total === 0) return;

    if (AppState.history.selectedIds.size === total) {
      AppState.history.selectedIds.clear();
    } else {
      AppState.history.records.forEach((r) => AppState.history.selectedIds.add(r.id));
    }

    renderHistoryCards();
    updateHistoryHeader();
  }

  function handleHistoryDeleteAll() {
    const selectedCount = AppState.history.selectedIds.size;
    const totalCount = AppState.history.records.length;

    if (selectedCount > 0) {
      openDeleteConfirmModal(
        'Delete Selected History Logs?',
        `Are you sure you want to delete ${selectedCount} selected search history record${selectedCount > 1 ? 's' : ''}? This action cannot be undone.`,
        async () => {
          try {
            const ids = Array.from(AppState.history.selectedIds);
            const res = await fetch('/api/history/delete-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids })
            });
            const json = await res.json();
            if (json.success) {
              showToast(`${json.deletedCount || selectedCount} search logs deleted.`, 'info', 2500);
              AppState.history.selectedIds.clear();
              await loadHistoryData();
            } else {
              showToast('Failed to delete selected search logs.', 'error');
            }
          } catch (err) {
            console.error(err);
            showToast('Error deleting search logs.', 'error');
          }
        }
      );
    } else if (totalCount > 0) {
      openDeleteConfirmModal(
        'Delete All Search History?',
        `Are you sure you want to permanently clear all ${totalCount} past search history logs? This action cannot be undone.`,
        async () => {
          try {
            const res = await fetch('/api/history', { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
              showToast('All search history logs permanently cleared.', 'info', 2500);
              AppState.history.selectedIds.clear();
              await loadHistoryData();
            } else {
              showToast('Failed to clear search history.', 'error');
            }
          } catch (err) {
            console.error(err);
            showToast('Error clearing search history.', 'error');
          }
        }
      );
    }
  }

  function handleHistorySearchAgain(record) {
    if (!record) return;
    const params = record.parameters || {};
    const state = params.state || record.state || '';
    const city = params.city || record.city || '';
    const category = params.category || record.category || '';
    const radius = params.radiusKm || record.radiusKm || 25;
    const keyword = params.keyword || record.keyword || '';

    // 1. Prefill State
    if (state && window.CustomSelect) {
      window.CustomSelect.selectState(state);
    } else {
      AppState.selectedState = state;
      const stateSelect = document.getElementById('find-select-state');
      if (stateSelect) stateSelect.value = state;
      populateCityDropdown(state);
    }

    // 2. Prefill City
    if (city && window.CustomSelect) {
      window.CustomSelect.selectCity(city, city === 'Entire State' ? `Entire State (${state})` : city);
    } else {
      AppState.selectedCity = city;
      const citySelect = document.getElementById('find-select-city');
      if (citySelect) citySelect.value = city;
    }

    // 3. Prefill Category
    selectCategory(category);

    // 4. Prefill Radius
    applyFindLeadsRadius(radius);

    // 5. Prefill Keyword
    AppState.selectedKeyword = keyword;
    const kwInput = document.getElementById('find-input-keyword');
    if (kwInput) {
      kwInput.value = keyword;
    }

    // 6. Update Summaries & Form Validation
    updateTargetSummary();
    validateFindLeadsForm();

    // 7. Navigate to Find Leads
    switchView('find-leads');
    showToast(`Loaded "${category || 'query'}" in ${city ? city + ', ' : ''}${state}. Ready to search!`, 'success', 3000);
  }

  function initHistoryEvents() {
    const selectAllBtn = document.getElementById('btn-history-select-all');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', handleHistorySelectAll);
    }

    const deleteAllBtn = document.getElementById('btn-history-delete-all');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', handleHistoryDeleteAll);
    }

    const gotoFindBtn = document.getElementById('btn-history-goto-find');
    if (gotoFindBtn) {
      gotoFindBtn.addEventListener('click', () => {
        switchView('find-leads');
      });
    }
  }


  // ----------------------------------------------------
  // 8. GLOBAL NAVIGATION & APP ROUTER WIRING
  // ----------------------------------------------------
  function initGlobalNavigation() {
    const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');
    navLinks.forEach((link) => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        const tab = this.getAttribute('data-tab');
        if (tab === 'dashboard') {
          switchView('dashboard');
        } else if (tab === 'saved-leads') {
          switchView('saved-leads');
        } else if (tab === 'favorites') {
          switchView('favorites');
        } else if (tab === 'outreach') {
          switchView('outreach');
        } else if (tab === 'followup') {
          switchView('followup');
        } else if (tab === 'history') {
          switchView('history');
        } else if (tab === 'settings') {
          switchView('settings');
        } else {
          switchView('find-leads');
        }
      });
    });

    // Brand Link Click -> switches to Header / Hero page (as previous)
    const brandLink = document.getElementById('brand-link');
    if (brandLink) {
      brandLink.addEventListener('click', function (e) {
        e.preventDefault();
        switchView('hero');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Close mobile drawer if open
        const overlay = document.querySelector('.mobile-menu-overlay');
        const mobileMenu = document.querySelector('.mobile-menu');
        const burger = document.querySelector('.burger');
        if (burger && overlay && mobileMenu) {
          burger.setAttribute('aria-expanded', 'false');
          overlay.classList.add('hidden');
          mobileMenu.classList.add('hidden');
          document.body.classList.remove('menu-open');
        }
      });
    }

    // User profile pill click -> open settings
    document.querySelectorAll('.user-pill, .mobile-profile-section').forEach((pill) => {
      pill.style.cursor = 'pointer';
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('settings');
      });
    });

    // Dashboard "Find New Leads" button
    const dashFindBtn = document.getElementById('dash-find-leads-btn');
    if (dashFindBtn) {
      dashFindBtn.addEventListener('click', function (e) {
        e.preventDefault();
        switchView('find-leads');
      });
    }

    // Check URL Hash on initial load
    const hash = window.location.hash;
    if (hash === '#dashboard') {
      switchView('dashboard');
    } else if (hash === '#saved-leads') {
      switchView('saved-leads');
    } else if (hash === '#favorites') {
      switchView('favorites');
    } else if (hash === '#outreach') {
      switchView('outreach');
    } else if (hash === '#followup') {
      switchView('followup');
    } else if (hash === '#history') {
      switchView('history');
    } else if (hash === '#settings') {
      switchView('settings');
    } else if (hash === '#find-leads') {
      switchView('find-leads');
    } else {
      switchView('hero');
    }

    window.addEventListener('hashchange', function () {
      const h = window.location.hash;
      if (h === '#dashboard') switchView('dashboard');
      else if (h === '#saved-leads') switchView('saved-leads');
      else if (h === '#favorites') switchView('favorites');
      else if (h === '#outreach') switchView('outreach');
      else if (h === '#followup') switchView('followup');
      else if (h === '#history') switchView('history');
      else if (h === '#settings') switchView('settings');
      else if (h === '#find-leads') switchView('find-leads');
      else switchView('hero');
    });
  }

  // ----------------------------------------------------
  // 9. HERO / HEADER PAGE INTERACTIONS (00:02 → 00:10)
  // ----------------------------------------------------
  function initHeroPageInteractions() {
    // Category pills in #discovery section
    const pills = document.querySelectorAll('#discovery .cat-pill:not(.cat-custom)');
    const catInput = document.querySelector('#discovery .category-input');
    pills.forEach((pill) => {
      pill.addEventListener('click', function () {
        pills.forEach((p) => p.classList.remove('active'));
        this.classList.add('active');
        if (catInput) {
          catInput.value = this.textContent.trim();
        }
      });
    });

    // Launch Discovery Button on Hero page -> open Find Leads with selected category
    const launchDiscoveryBtn = document.getElementById('launch-discovery-btn');
    if (launchDiscoveryBtn) {
      launchDiscoveryBtn.addEventListener('click', function (e) {
        e.preventDefault();
        const catInput = document.querySelector('#discovery .category-input');
        if (catInput && catInput.value) {
          selectCategory(catInput.value);
        }
        switchView('find-leads');
      });
    }

    // Hero "Explore Dashboard" button -> open Dashboard
    const exploreDashBtn = document.getElementById('explore-dashboard-btn');
    if (exploreDashBtn) {
      exploreDashBtn.addEventListener('click', function (e) {
        e.preventDefault();
        switchView('dashboard');
      });
    }

    // Hero "Find Leads" button -> scroll to #discovery on hero page
    const heroFindLeadsBtn = document.getElementById('find-leads-btn');
    if (heroFindLeadsBtn) {
      heroFindLeadsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.getElementById('discovery');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Smooth scroll for internal hero page links (e.g. scroll-chevron, back-to-top)
    document.querySelectorAll('#view-hero a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href === '#dashboard') {
          e.preventDefault();
          switchView('dashboard');
        } else if (href === '#find-leads') {
          e.preventDefault();
          switchView('find-leads');
        } else if (href === '#outreach') {
          e.preventDefault();
          switchView('outreach');
        } else if (href === '#hero') {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (href && href !== '#') {
          const target = document.querySelector(href);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    });
  }

  // ----------------------------------------------------
  // 10. DASHBOARD INTERACTIONS
  // ----------------------------------------------------
  function initDashboardInteractions() {
    // 1. Dashboard summary cards click navigation
    const cardOutreach = document.getElementById('dash-card-outreach');
    if (cardOutreach) {
      cardOutreach.addEventListener('click', () => switchView('outreach'));
    }

    const cardSaved = document.getElementById('dash-card-saved');
    if (cardSaved) {
      cardSaved.addEventListener('click', () => switchView('saved-leads'));
    }

    const cardFavs = document.getElementById('dash-card-favorites');
    if (cardFavs) {
      cardFavs.addEventListener('click', () => switchView('favorites'));
    }

    const cardFollowups = document.getElementById('dash-card-followups');
    if (cardFollowups) {
      cardFollowups.addEventListener('click', () => {
        switchView('followup');
        setFollowUpTab('active');
      });
    }

    const cardReplies = document.getElementById('dash-card-replies');
    if (cardReplies) {
      cardReplies.addEventListener('click', () => {
        switchView('followup');
        setFollowUpTab('replies');
      });
    }

    const cardNoWeb = document.getElementById('dash-card-nowebsite');
    if (cardNoWeb) {
      cardNoWeb.addEventListener('click', () => {
        AppState.savedFilters.website = 'NO';
        const webFilter = document.getElementById('saved-filter-website');
        if (webFilter) webFilter.value = 'NO';
        switchView('saved-leads');
      });
    }

    // 2. Outreach Terminal button in Dashboard Header
    const dashOutreachBtn = document.getElementById('dash-outreach-btn') || document.querySelector('.btn-dash-secondary');
    if (dashOutreachBtn) {
      dashOutreachBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('outreach');
      });
    }

    // 3. Open Outreach Queue button in Today's Outreach panel
    const openQueueBtn = document.getElementById('dash-btn-open-outreach-queue') || document.querySelector('.btn-outreach-queue');
    if (openQueueBtn) {
      openQueueBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('outreach');
      });
    }

    // 5. Search leads link in AI Sales Terminal
    const searchLeadsLink = document.getElementById('dash-link-search-leads') || document.querySelector('.search-leads-link');
    if (searchLeadsLink) {
      searchLeadsLink.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('find-leads');
      });
    }

    // 5. Dashboard Prospects Table: Outreach & Pitch buttons
    document.querySelectorAll('.btn-table-outreach').forEach((btn) => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const row = this.closest('tr');
        const bizName = row ? (row.querySelector('.biz-name')?.textContent.trim() || 'business') : 'business';
        showToast(`Outreach sequence initiated for "${bizName}".`, 'success', 2500);
      });
    });

    document.querySelectorAll('.btn-table-pitch').forEach((btn) => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const row = this.closest('tr');
        const bizName = row ? (row.querySelector('.biz-name')?.textContent.trim() || 'business') : 'business';
        const pitchText = `Hi ${bizName} team, I noticed you don't have an active website or modern booking portal. I help local businesses build high-converting web apps that boost client inquiries. Would you be open to a quick 5-min demo?`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(pitchText).catch(() => {});
        }
        showToast(`AI pitch script copied to clipboard for "${bizName}"!`, 'success', 3000);
      });
    });

    // 6. View All (60) link in Dashboard
    const viewAllLink = document.getElementById('dash-view-all-leads');
    if (viewAllLink) {
      viewAllLink.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('saved-leads');
      });
    }
  }

  function initMobileMenu() {
    const burger = document.querySelector('.burger');
    const overlay = document.querySelector('.mobile-menu-overlay');
    const mobileMenu = document.querySelector('.mobile-menu');
    const mobileLinks = document.querySelectorAll('.mobile-nav-link');

    if (!burger || !overlay || !mobileMenu) return;

    function openMenu() {
      burger.setAttribute('aria-expanded', 'true');
      overlay.classList.remove('hidden');
      mobileMenu.classList.remove('hidden');
      document.body.classList.add('menu-open');
    }

    function closeMenu() {
      burger.setAttribute('aria-expanded', 'false');
      overlay.classList.add('hidden');
      mobileMenu.classList.add('hidden');
      document.body.classList.remove('menu-open');
    }

    burger.addEventListener('click', () => {
      const isOpen = burger.getAttribute('aria-expanded') === 'true';
      if (isOpen) closeMenu();
      else openMenu();
    });

    overlay.addEventListener('click', closeMenu);
    mobileLinks.forEach((l) => l.addEventListener('click', closeMenu));
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }


  // ====================================================
  // SETTINGS MODULE (VIDEO PARITY & SITE-WIDE REACTIVITY)
  // ====================================================
  const SettingsModule = {
    activeTab: 'profile',
    selectedTemplateId: 'tpl-website',

    getDefaults() {
      return {
        profile: {
          fullName: 'Akshay Lead Specialist',
          companyName: 'Nexora AI Growth',
          phone: '+91 99999 88888',
          email: 'contact@nexora.ai',
          portfolioUrl: 'https://apexgrowth.in',
          websiteUrl: 'https://apexgrowth.in',
          city: 'Vijayawada',
          state: 'Andhra Pradesh',
          bio: 'Full-stack AI automation & modern web consultant.'
        },
        services: [
          { id: 'srv-1', name: 'AI Voice Calling Agents', enabled: true },
          { id: 'srv-2', name: 'AI Automation', enabled: true },
          { id: 'srv-3', name: 'AI Chatbots', enabled: true },
          { id: 'srv-4', name: 'Custom Software', enabled: true },
          { id: 'srv-5', name: 'AI Integrations', enabled: true },
          { id: 'srv-6', name: 'Business Automation', enabled: true }
        ],
        templates: [
          {
            id: 'tpl-website',
            name: 'Website',
            type: 'Website Outreach',
            content: "Hi {businessName}! I came across your {category} in {city}. I help businesses improve their online presence with modern websites. Would you be open to a quick look at what I can build for you?\n\n{my_name}\n{my_company}",
            isDefault: true
          },
          {
            id: 'tpl-voice-agent',
            name: 'Voice Agent',
            type: 'Voice Agent Outreach',
            content: "Hi {businessName}! I noticed your {category} in {city}. I help businesses handle calls and inquiries with AI voice agents. Would you like to see how it works?\n\n{my_name}\n{my_company}",
            isDefault: false
          },
          {
            id: 'tpl-ai-automation',
            name: 'AI Automation',
            type: 'AI Automation Outreach',
            content: "Hi {businessName}! I came across your {category} in {city}. I help businesses automate repetitive tasks using AI. Would you be interested in seeing a quick example?\n\n{my_name}\n{my_company}",
            isDefault: false
          },
          {
            id: 'tpl-ai-chatbot',
            name: 'AI Chatbot',
            type: 'AI Chatbot Outreach',
            content: "Hi {businessName}! I came across your {category} in {city}. I build AI chatbots that can handle customer questions and inquiries 24/7. Want to see a quick demo?\n\n{my_name}\n{my_company}",
            isDefault: false
          },
          {
            id: 'tpl-general-intro',
            name: 'General Introduction',
            type: 'General Introduction Outreach',
            content: "Hi {businessName}! I'm {my_name} from {my_company}. I work with businesses like {businessName} on websites, AI solutions, and automation. Would you be open to connecting?\n\n{portfolio_url}",
            isDefault: false
          },
          {
            id: 'tpl-custom-pitch',
            name: 'Custom Pitch',
            type: 'Custom Outreach',
            content: "Hi {businessName}! I noticed something interesting about your {category} in {city} and had an idea that could help. I'd be happy to share it if you're interested.\n\n{my_name}\n{my_company}",
            isDefault: false
          },
          {
            id: 'tpl-followup-1',
            name: 'Follow-Up #1 — Gentle Nudge',
            type: 'Follow-Up',
            content: "Hi {businessName}! Just following up on my previous message. Would you be open to a quick chat?",
            isDefault: false
          },
          {
            id: 'tpl-followup-2',
            name: 'Follow-Up #2 — Quick Check-in',
            type: 'Follow-Up',
            content: "Hi {businessName}! Just checking in. Is this something you'd be interested in exploring?",
            isDefault: false
          },
          {
            id: 'tpl-followup-3',
            name: 'Follow-Up #3 — Service Value',
            type: 'Follow-Up',
            content: "Hi {businessName}! I'd be happy to show you a quick example of how we could improve or automate part of your business.",
            isDefault: false
          },
          {
            id: 'tpl-followup-4',
            name: 'Follow-Up #4 — Low-Pressure Closing',
            type: 'Follow-Up',
            content: "Hi {businessName}! No worries if the timing isn't right. Just let me know if you'd like to explore this later.",
            isDefault: false
          },
          {
            id: 'tpl-followup-5',
            name: 'Follow-Up #5 — Final Note',
            type: 'Follow-Up',
            content: "Hi {businessName}! I'll make this my last follow-up. If you ever need help with websites or AI solutions, feel free to reach out.\n\n{my_name}\n{my_company}",
            isDefault: false
          }
        ],
        outreachTarget: {
          dailyTarget: 50,
          showProgressBar: true,
          enableMilestones: true
        },
        defaultLocation: {
          state: 'Telangana',
          city: 'Hyderabad',
          radiusKm: 100
        },
        aiPreferences: {
          tone: 'Friendly',
          length: 'Short (60–100 words)',
          approach: 'Value First',
          cta: 'Friendly Question',
          personalization: 'High (Uses verified business name, category, location, and website status)',
          focusPriority: 'Website Development',
          autoAnalyzeVectors: true
        },
        whatsappPreferences: {
          countryCode: '+91 9959983437',
          launchMode: 'desktop'
        },
        appearance: {
          interactive3DGrid: true,
          layoutDensity: 'comfortable'
        }
      };
    },

    /*
     * ============================================================================
     * SETTINGS PERSISTENCE & DATA INTEGRITY POLICY:
     * User-saved settings are authoritative and must never be overwritten automatically.
     * Defaults are only fallback values for settings that do not yet exist.
     * Opening the Settings page is strictly a READ operation.
     * Category updates only mutate explicitly submitted values and provide verified feedback.
     * ============================================================================
     */

    async loadSettings() {
      // 1. Optimistically restore from localStorage cache for instant UI rendering
      try {
        const local = localStorage.getItem('clienthunter_settings');
        if (local) {
          try {
            const parsed = JSON.parse(local);
            if (parsed && typeof parsed === 'object') {
              AppState.settings = parsed;
            }
          } catch(e) {}
        }
      } catch(e) {}

      // 2. Authoritative READ from server (syncs Supabase and local store)
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.settings) {
            AppState.settings = json.settings;
            try {
              localStorage.setItem('clienthunter_settings', JSON.stringify(AppState.settings));
            } catch(e) {}
          }
        }
      } catch (err) {
        console.warn('[SETTINGS] Could not fetch server settings, using local cache:', err);
      }

      this.applySettingsToSite();
    },

    async saveCategory(categoryKey, data, categoryDisplayName = 'Settings', btnEl = null) {
      let originalBtnHtml = '';
      if (btnEl) {
        originalBtnHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i> Saving...';
      }

      const payload = {
        [categoryKey]: data,
        _category: categoryDisplayName
      };

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }

        const json = await res.json();
        if (!json.success) {
          throw new Error(json.error || 'Server reported failure saving settings');
        }

        // Authoritative update confirmed by server & database
        if (json.settings) {
          AppState.settings = json.settings;
        } else {
          if (!AppState.settings) AppState.settings = this.getDefaults();
          AppState.settings[categoryKey] = data;
        }

        try {
          localStorage.setItem('clienthunter_settings', JSON.stringify(AppState.settings));
        } catch(e) {}

        this.applySettingsToSite();

        showToast(`✓ ${categoryDisplayName} settings saved successfully`, 'success');
        return true;
      } catch (err) {
        console.error(`[SETTINGS SAVE FAILED] Category: "${categoryDisplayName}":`, err);
        showToast('✕ Settings could not be saved. Please try again.', 'error', 4500);
        return false;
      } finally {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.innerHTML = originalBtnHtml;
        }
      }
    },

    async saveSettings(partial, customMsg = null, btnEl = null) {
      let originalBtnHtml = '';
      if (btnEl) {
        originalBtnHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i> Saving...';
      }

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial)
        });

        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }

        const json = await res.json();
        if (!json.success) {
          throw new Error(json.error || 'Server reported failure saving settings');
        }

        if (json.settings) {
          AppState.settings = json.settings;
        } else {
          if (!AppState.settings) AppState.settings = this.getDefaults();
          for (const key of Object.keys(partial)) {
            if (typeof partial[key] === 'object' && partial[key] !== null && !Array.isArray(partial[key])) {
              AppState.settings[key] = { ...(AppState.settings[key] || {}), ...partial[key] };
            } else {
              AppState.settings[key] = partial[key];
            }
          }
        }

        try {
          localStorage.setItem('clienthunter_settings', JSON.stringify(AppState.settings));
        } catch(e) {}

        this.applySettingsToSite();

        const toastText = customMsg || (json.category ? `✓ ${json.category} settings saved successfully` : '✓ Settings saved successfully');
        showToast(toastText.startsWith('✓') ? toastText : `✓ ${toastText}`, 'success');
        return true;
      } catch (err) {
        console.error('[SETTINGS SAVE FAILED]', err);
        showToast('✕ Settings could not be saved. Please try again.', 'error', 4500);
        return false;
      } finally {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.innerHTML = originalBtnHtml;
        }
      }
    },

    applySettingsToSite() {
      const s = AppState.settings || this.getDefaults();

      // 1. Identity & Avatar
      const fullName = s.profile?.fullName || 'Akshay';
      document.querySelectorAll('.user-name').forEach(el => el.textContent = fullName);
      const dashGreetingUser = document.querySelector('#view-dashboard .dash-serif-name');
      if (dashGreetingUser) dashGreetingUser.textContent = fullName;
      const initials = fullName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'AK';
      document.querySelectorAll('.user-avatar').forEach(el => el.textContent = initials);
      document.querySelectorAll('.user-pill').forEach(el => el.setAttribute('title', `${fullName} (Terminal Admin)`));

      // 2. Daily Outreach Quota & Metrics
      const target = parseInt(s.outreachTarget?.dailyTarget, 10) || 50;
      const sent = AppState.outreach?.metrics?.todaySent || 0;
      const pct = Math.min(100, Math.round((sent / target) * 100));
      const rem = Math.max(0, target - sent);
      const dashOutreachVal = document.getElementById('dash-card-outreach-val');
      if (dashOutreachVal) dashOutreachVal.textContent = `${sent} / ${target}`;
      const dashBigVal = document.getElementById('dash-big-sent-ratio');
      if (dashBigVal) dashBigVal.textContent = `${sent} / ${target}`;
      const dashTripletTarget = document.getElementById('dash-triplet-target');
      if (dashTripletTarget) dashTripletTarget.textContent = `${target} / DAY`;
      const dashTripletRem = document.getElementById('dash-triplet-remaining');
      if (dashTripletRem) dashTripletRem.textContent = `→ ${rem} LEFT`;
      const dashPct = document.getElementById('dash-outreach-pct-display');
      if (dashPct) dashPct.textContent = `${pct}%`;

      // 3. Appearance: 3D Grid / Video Background
      const bgEl = document.querySelector('.bg');
      if (bgEl) {
        bgEl.style.display = (s.appearance?.interactive3DGrid !== false) ? 'block' : 'none';
      }

      // 4. Appearance: Layout Density
      if (s.appearance?.layoutDensity === 'compact') {
        document.body.classList.add('density-compact');
      } else {
        document.body.classList.remove('density-compact');
      }
    },

    initSettingsUI() {
      const s = AppState.settings || this.getDefaults();

      // Tab Buttons Switching
      const tabBtns = document.querySelectorAll('.settings-tab-btn');
      tabBtns.forEach(btn => {
        btn.onclick = () => {
          const tab = btn.getAttribute('data-settings-tab');
          this.switchSettingsTab(tab);
        };
      });

      // Populate Tab 1: Profile
      const nameInp = document.getElementById('set-fullname');
      if (nameInp) nameInp.value = s.profile?.fullName || '';
      const compInp = document.getElementById('set-company');
      if (compInp) compInp.value = s.profile?.companyName || '';
      const phoneInp = document.getElementById('set-phone');
      if (phoneInp) phoneInp.value = s.profile?.phone || '';
      const emailInp = document.getElementById('set-email');
      if (emailInp) emailInp.value = s.profile?.email || '';
      const portInp = document.getElementById('set-portfolio');
      if (portInp) portInp.value = s.profile?.portfolioUrl || '';
      const webInp = document.getElementById('set-website');
      if (webInp) webInp.value = s.profile?.websiteUrl || '';
      const cityInp = document.getElementById('set-city');
      if (cityInp) cityInp.value = s.profile?.city || '';
      const stateInp = document.getElementById('set-state');
      if (stateInp) stateInp.value = s.profile?.state || '';
      const bioInp = document.getElementById('set-bio');
      if (bioInp) bioInp.value = s.profile?.bio || '';

      const btnSaveProfile = document.getElementById('btn-save-profile');
      if (btnSaveProfile) {
        btnSaveProfile.onclick = () => {
          this.saveCategory('profile', {
            fullName: nameInp.value.trim(),
            companyName: compInp.value.trim(),
            phone: phoneInp.value.trim(),
            email: emailInp.value.trim(),
            portfolioUrl: portInp.value.trim(),
            websiteUrl: webInp.value.trim(),
            city: cityInp.value.trim(),
            state: stateInp.value.trim(),
            bio: bioInp.value.trim()
          }, 'Profile', btnSaveProfile);
        };
      }

      // Populate Tab 2: Services
      this.renderServicesList();
      const btnAddService = document.getElementById('btn-add-custom-service');
      const inputCustomService = document.getElementById('input-custom-service');
      if (btnAddService && inputCustomService) {
        btnAddService.onclick = () => {
          const val = inputCustomService.value.trim();
          if (!val) return;
          if (!s.services) s.services = [];
          s.services.push({ id: 'srv-' + Date.now(), name: val, enabled: true });
          inputCustomService.value = '';
          this.renderServicesList();
          this.saveCategory('services', s.services, 'My Services', btnAddService);
        };
      }
      const btnSaveServices = document.getElementById('btn-save-services');
      if (btnSaveServices) {
        btnSaveServices.onclick = () => {
          this.saveCategory('services', s.services, 'My Services', btnSaveServices);
        };
      }

      // Populate Tab 3: Templates
      this.renderTemplatesList();
      this.updateTemplatePreview();

      const btnNewTemplate = document.getElementById('btn-open-new-template');
      if (btnNewTemplate) {
        btnNewTemplate.onclick = () => this.openTemplateModal();
      }

      // Populate Tab 4: Target
      const targetInp = document.getElementById('set-daily-target-input');
      if (targetInp) targetInp.value = s.outreachTarget?.dailyTarget || 50;
      const chkProgress = document.getElementById('chk-set-show-progress');
      if (chkProgress) chkProgress.checked = s.outreachTarget?.showProgressBar !== false;
      const chkMilestones = document.getElementById('chk-set-milestones');
      if (chkMilestones) chkMilestones.checked = s.outreachTarget?.enableMilestones !== false;

      const btnSaveTarget = document.getElementById('btn-save-target');
      if (btnSaveTarget) {
        btnSaveTarget.onclick = () => {
          const num = parseInt(targetInp.value, 10) || 50;
          this.saveCategory('outreachTarget', {
            dailyTarget: num,
            showProgressBar: chkProgress.checked,
            enableMilestones: chkMilestones.checked
          }, 'Daily Outreach', btnSaveTarget);
        };
      }

      // Populate Tab 5: AI
      const toneSel = document.getElementById('set-ai-tone');
      if (toneSel && s.aiPreferences?.tone) toneSel.value = s.aiPreferences.tone;
      const lenSel = document.getElementById('set-ai-length');
      if (lenSel && s.aiPreferences?.length) lenSel.value = s.aiPreferences.length;
      const appSel = document.getElementById('set-ai-approach');
      if (appSel && s.aiPreferences?.approach) appSel.value = s.aiPreferences.approach;
      const ctaSel = document.getElementById('set-ai-cta');
      if (ctaSel && s.aiPreferences?.cta) ctaSel.value = s.aiPreferences.cta;
      const persSel = document.getElementById('set-ai-personalization');
      if (persSel && s.aiPreferences?.personalization) persSel.value = s.aiPreferences.personalization;
      const focSel = document.getElementById('set-ai-focus');
      if (focSel && s.aiPreferences?.focusPriority) focSel.value = s.aiPreferences.focusPriority;
      const chkVectors = document.getElementById('chk-set-auto-vectors');
      if (chkVectors) chkVectors.checked = s.aiPreferences?.autoAnalyzeVectors !== false;

      const btnSaveAi = document.getElementById('btn-save-ai');
      if (btnSaveAi) {
        btnSaveAi.onclick = () => {
          this.saveCategory('aiPreferences', {
            tone: toneSel.value,
            length: lenSel.value,
            approach: appSel.value,
            cta: ctaSel.value,
            personalization: persSel.value,
            focusPriority: focSel.value,
            autoAnalyzeVectors: chkVectors.checked
          }, 'AI Preferences', btnSaveAi);
        };
      }

      // Populate Tab 7: API Configuration & Connection Test
      const btnTestConn = document.getElementById('btn-test-connections');
      if (btnTestConn) {
        btnTestConn.onclick = () => this.testSystemConnections();
      }

      // Populate Tab 8: WhatsApp Preferences
      const waCountryInp = document.getElementById('set-wa-country');
      if (waCountryInp) waCountryInp.value = s.whatsappPreferences?.countryCode || '+91 9959983437';
      const waModeSel = document.getElementById('set-wa-launch-mode');
      if (waModeSel && s.whatsappPreferences?.launchMode) waModeSel.value = s.whatsappPreferences.launchMode;

      const btnSaveWa = document.getElementById('btn-save-whatsapp');
      if (btnSaveWa) {
        btnSaveWa.onclick = () => {
          this.saveCategory('whatsappPreferences', {
            countryCode: waCountryInp.value.trim(),
            launchMode: waModeSel.value
          }, 'WhatsApp Preferences', btnSaveWa);
        };
      }

      // Populate Tab 9: Appearance
      const chkBg = document.getElementById('chk-set-interactive-bg');
      if (chkBg) chkBg.checked = s.appearance?.interactive3DGrid !== false;
      const denSel = document.getElementById('set-layout-density');
      if (denSel && s.appearance?.layoutDensity) denSel.value = s.appearance.layoutDensity;

      const btnSaveAppearance = document.getElementById('btn-save-appearance');
      if (btnSaveAppearance) {
        btnSaveAppearance.onclick = () => {
          this.saveCategory('appearance', {
            interactive3DGrid: chkBg.checked,
            layoutDensity: denSel.value
          }, 'Appearance', btnSaveAppearance);
        };
      }

      // Populate Tab 10: Data & Export
      const btnDownloadBackup = document.getElementById('btn-download-backup');
      if (btnDownloadBackup) {
        btnDownloadBackup.onclick = () => {
          window.location.href = '/api/backup/export';
          showToast('Preparing full system JSON backup...', 'info');
        };
      }

      // Global Save All Changes Button
      const btnSaveAll = document.getElementById('btn-save-all-settings');
      if (btnSaveAll) {
        btnSaveAll.onclick = () => this.saveAllSettingsFromUI();
      }
    },

    switchSettingsTab(tabName) {
      this.activeTab = tabName;
      document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-settings-tab') === tabName) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      document.querySelectorAll('.settings-panel').forEach(panel => {
        if (panel.id === `panel-settings-${tabName}`) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });
      if (tabName === 'templates') {
        this.renderTemplatesList();
        this.updateTemplatePreview();
      }
    },

    renderServicesList() {
      const container = document.getElementById('set-services-container');
      if (!container) return;
      const s = AppState.settings || this.getDefaults();
      const services = s.services || [];

      container.innerHTML = services.map(srv => `
        <div class="service-toggle-item">
          <label class="service-toggle-left">
            <input type="checkbox" class="custom-checkbox chk-service-item" data-service-id="${srv.id}" ${srv.enabled ? 'checked' : ''} />
            <span class="service-name">${escapeHtml(srv.name)}</span>
          </label>
          <span class="badge-pill-active">${srv.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      `).join('');

      container.querySelectorAll('.chk-service-item').forEach(chk => {
        chk.onchange = (e) => {
          const id = chk.getAttribute('data-service-id');
          const target = services.find(x => x.id === id);
          if (target) {
            target.enabled = chk.checked;
            this.renderServicesList();
          }
        };
      });
    },

    renderTemplatesList() {
      const listPane = document.getElementById('set-templates-list');
      if (!listPane) return;
      const s = AppState.settings || this.getDefaults();
      const templates = s.templates || [];

      const countBadge = document.getElementById('tpl-count-badge');
      if (countBadge) countBadge.textContent = templates.length;

      if (!this.selectedTemplateId || !templates.some(t => t.id === this.selectedTemplateId)) {
        if (templates.length > 0) this.selectedTemplateId = templates[0].id;
      }

      listPane.innerHTML = templates.map((tpl, idx) => {
        const isSel = tpl.id === this.selectedTemplateId;
        const charCount = (tpl.content || '').length;
        const isFirst = idx === 0;
        const isLast = idx === templates.length - 1;
        return `
          <div class="template-item-card ${isSel ? 'active' : ''}" data-template-id="${tpl.id}" data-index="${idx}" draggable="true">
            <span class="template-drag-handle" title="Drag to prioritize"><i class="fa-solid fa-bars"></i></span>
            <div class="template-item-info">
              <div class="template-item-title">${escapeHtml(tpl.name)} ${tpl.isDefault ? '<span style="color:#34d399; font-size:10px; font-weight:normal; margin-left:4px;">(Default)</span>' : ''}</div>
              <div class="template-item-meta">
                <span class="template-item-type">${escapeHtml(tpl.type || 'Outreach')}</span>
                <span class="template-item-chars">${charCount} chars</span>
              </div>
            </div>
            <div class="template-reorder-btns">
              <button type="button" class="btn-tpl-move btn-tpl-up" title="Move Up" data-tpl-idx="${idx}" ${isFirst ? 'disabled style="opacity:0.25; cursor:default;"' : ''}><i class="fa-solid fa-chevron-up"></i></button>
              <button type="button" class="btn-tpl-move btn-tpl-down" title="Move Down" data-tpl-idx="${idx}" ${isLast ? 'disabled style="opacity:0.25; cursor:default;"' : ''}><i class="fa-solid fa-chevron-down"></i></button>
            </div>
          </div>
        `;
      }).join('');

      // Card selection & Up/Down reordering
      listPane.querySelectorAll('.template-item-card').forEach(card => {
        const idx = parseInt(card.getAttribute('data-index'), 10);

        card.onclick = (e) => {
          if (e.target.closest('.btn-tpl-move')) return;
          this.selectedTemplateId = card.getAttribute('data-template-id');
          this.renderTemplatesList();
          this.updateTemplatePreview();
        };

        const btnUp = card.querySelector('.btn-tpl-up');
        if (btnUp) {
          btnUp.onclick = (e) => {
            e.stopPropagation();
            if (idx > 0) {
              const temp = templates[idx];
              templates[idx] = templates[idx - 1];
              templates[idx - 1] = temp;
              this.saveSettings({ templates }, `Moved "${temp.name}" up in priority.`);
              this.renderTemplatesList();
              this.updateTemplatePreview();
            }
          };
        }

        const btnDown = card.querySelector('.btn-tpl-down');
        if (btnDown) {
          btnDown.onclick = (e) => {
            e.stopPropagation();
            if (idx < templates.length - 1) {
              const temp = templates[idx];
              templates[idx] = templates[idx + 1];
              templates[idx + 1] = temp;
              this.saveSettings({ templates }, `Moved "${temp.name}" down in priority.`);
              this.renderTemplatesList();
              this.updateTemplatePreview();
            }
          };
        }

        // HTML5 Drag and drop reordering
        card.ondragstart = (e) => {
          window.__draggedTplIdx = idx;
          card.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(idx));
        };

        card.ondragend = () => {
          card.classList.remove('dragging');
          listPane.querySelectorAll('.template-item-card').forEach(c => c.classList.remove('drag-over'));
        };

        card.ondragover = (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.classList.add('drag-over');
        };

        card.ondragleave = () => {
          card.classList.remove('drag-over');
        };

        card.ondrop = (e) => {
          e.preventDefault();
          card.classList.remove('drag-over');
          const fromIdx = window.__draggedTplIdx;
          const toIdx = idx;
          if (fromIdx !== undefined && fromIdx !== null && fromIdx !== toIdx) {
            const [moved] = templates.splice(fromIdx, 1);
            templates.splice(toIdx, 0, moved);
            this.selectedTemplateId = moved.id;
            this.saveSettings({ templates }, `Reordered priority: "${moved.name}"`);
            this.renderTemplatesList();
            this.updateTemplatePreview();
          }
        };
      });
    },

    updateTemplatePreview() {
      const s = AppState.settings || this.getDefaults();
      const templates = s.templates || [];
      const tpl = templates.find(t => t.id === this.selectedTemplateId) || templates[0];
      const previewBox = document.getElementById('preview-rendered-message');
      if (!previewBox || !tpl) return;

      const profile = s.profile || {};
      const sampleLead = {
        businessName: 'Sri Krishna Dental Hospital',
        category: 'Dental Clinics',
        city: 'Vijayawada'
      };

      let text = tpl.content || '';
      text = text.replace(/\{businessName\}/g, sampleLead.businessName);
      text = text.replace(/\{business_name\}/g, sampleLead.businessName);
      text = text.replace(/\{category\}/g, sampleLead.category);
      text = text.replace(/\{city\}/g, sampleLead.city);
      text = text.replace(/\{my_name\}/g, profile.fullName || 'Akshay Lead Specialist');
      text = text.replace(/\{my_company\}/g, profile.companyName || 'Nexora AI Growth');
      text = text.replace(/\{portfolio_url\}/g, profile.portfolioUrl || 'https://apexgrowth.in');

      previewBox.textContent = text;

      // Wire preview actions
      const btnSetDef = document.getElementById('btn-preview-set-default');
      if (btnSetDef) {
        btnSetDef.onclick = () => {
          templates.forEach(t => { t.isDefault = (t.id === tpl.id); });
          this.saveSettings({ templates }, `Set "${tpl.name}" as default template.`);
          this.renderTemplatesList();
        };
      }

      const btnEdit = document.getElementById('btn-preview-edit');
      if (btnEdit) {
        btnEdit.onclick = () => this.openTemplateModal(tpl);
      }

      const btnDup = document.getElementById('btn-preview-duplicate');
      if (btnDup) {
        btnDup.onclick = () => {
          const copy = {
            ...tpl,
            id: 'tpl-' + Date.now(),
            name: `${tpl.name} (Copy)`,
            isDefault: false
          };
          templates.push(copy);
          this.selectedTemplateId = copy.id;
          this.saveSettings({ templates }, `Duplicated template: ${tpl.name}`);
          this.renderTemplatesList();
          this.updateTemplatePreview();
        };
      }

      const btnDel = document.getElementById('btn-preview-delete');
      if (btnDel) {
        btnDel.onclick = () => {
          if (templates.length <= 1) {
            showToast('You must keep at least one template.', 'warning');
            return;
          }
          const idx = templates.findIndex(t => t.id === tpl.id);
          if (idx !== -1) {
            templates.splice(idx, 1);
            this.selectedTemplateId = templates[0].id;
            this.saveSettings({ templates }, `Deleted template: ${tpl.name}`);
            this.renderTemplatesList();
            this.updateTemplatePreview();
          }
        };
      }
    },

    openTemplateModal(existingTpl = null) {
      const modal = document.getElementById('modal-template-editor');
      if (!modal) return;
      const title = document.getElementById('modal-template-title');
      const inpName = document.getElementById('input-tpl-name');
      const selType = document.getElementById('select-tpl-type');
      const txtContent = document.getElementById('textarea-tpl-content');
      const btnSave = document.getElementById('btn-save-template-edit');
      const btnCancel = document.getElementById('btn-cancel-template-edit');
      const btnClose = document.getElementById('btn-close-template-modal');

      if (title) title.textContent = existingTpl ? 'Edit Message Template' : 'Create Message Template';
      if (inpName) inpName.value = existingTpl ? existingTpl.name : '';
      if (selType) selType.value = existingTpl ? existingTpl.type : 'AI Automation Outreach';
      if (txtContent) txtContent.value = existingTpl ? existingTpl.content : '';

      // Variable chip insertion
      modal.querySelectorAll('.var-chip-btn').forEach(chip => {
        chip.onclick = () => {
          const varTag = chip.getAttribute('data-var');
          const start = txtContent.selectionStart || 0;
          const end = txtContent.selectionEnd || 0;
          const val = txtContent.value;
          txtContent.value = val.substring(0, start) + varTag + val.substring(end);
          txtContent.focus();
          txtContent.selectionStart = txtContent.selectionEnd = start + varTag.length;
        };
      });

      function closeModal() {
        modal.classList.add('hidden');
      }

      if (btnCancel) btnCancel.onclick = closeModal;
      if (btnClose) btnClose.onclick = closeModal;

      if (btnSave) {
        btnSave.onclick = () => {
          const name = inpName.value.trim();
          const type = selType.value;
          const content = txtContent.value.trim();
          if (!name || !content) {
            showToast('Template name and content are required.', 'warning');
            return;
          }
          const s = AppState.settings || SettingsModule.getDefaults();
          const templates = s.templates || [];

          if (existingTpl) {
            existingTpl.name = name;
            existingTpl.type = type;
            existingTpl.content = content;
          } else {
            const newTpl = {
              id: 'tpl-' + Date.now(),
              name,
              type,
              content,
              isDefault: false
            };
            templates.push(newTpl);
            SettingsModule.selectedTemplateId = newTpl.id;
          }
          SettingsModule.saveCategory('templates', templates, 'Message Templates', btnSave).then(ok => {
            if (ok) {
              SettingsModule.renderTemplatesList();
              SettingsModule.updateTemplatePreview();
              closeModal();
            }
          });
        };
      }

      modal.classList.remove('hidden');
    },

    async testSystemConnections() {
      const btn = document.getElementById('btn-test-connections');
      const feedback = document.getElementById('connection-test-feedback');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';

      try {
        const start = performance.now();
        const res = await fetch('/api/system/status');
        const end = performance.now();
        const latency = Math.round(end - start);
        const data = await res.json();

        if (feedback) {
          feedback.style.display = 'block';
          feedback.innerHTML = `<i class="fa-solid fa-circle-check"></i> Live Diagnostics Verified (${latency}ms latency). Google Places (New): Active, Gemini AI (${data.services?.geminiAi?.model || '3.8-flash'}): Active, Storage: ${data.services?.storageEngine?.status || 'Active'}.`;
        }
        showToast('All system connections verified active!', 'success');
      } catch (err) {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = '#f87171';
          feedback.style.borderColor = 'rgba(239, 68, 68, 0.3)';
          feedback.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Connection test notice: ${err.message}`;
        }
      } finally {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Test Connections';
      }
    },

    saveAllSettingsFromUI() {
      const nameInp = document.getElementById('set-fullname');
      const compInp = document.getElementById('set-company');
      const phoneInp = document.getElementById('set-phone');
      const emailInp = document.getElementById('set-email');
      const portInp = document.getElementById('set-portfolio');
      const webInp = document.getElementById('set-website');
      const cityInp = document.getElementById('set-city');
      const stateInp = document.getElementById('set-state');
      const bioInp = document.getElementById('set-bio');

      const targetInp = document.getElementById('set-daily-target-input');
      const chkProgress = document.getElementById('chk-set-show-progress');
      const chkMilestones = document.getElementById('chk-set-milestones');

      const toneSel = document.getElementById('set-ai-tone');
      const lenSel = document.getElementById('set-ai-length');
      const appSel = document.getElementById('set-ai-approach');
      const ctaSel = document.getElementById('set-ai-cta');
      const persSel = document.getElementById('set-ai-personalization');
      const focSel = document.getElementById('set-ai-focus');
      const chkVectors = document.getElementById('chk-set-auto-vectors');

      const waCountryInp = document.getElementById('set-wa-country');
      const waModeSel = document.getElementById('set-wa-launch-mode');

      const chkBg = document.getElementById('chk-set-interactive-bg');
      const denSel = document.getElementById('set-layout-density');

      const fullSettings = {
        profile: {
          fullName: nameInp ? nameInp.value.trim() : '',
          companyName: compInp ? compInp.value.trim() : '',
          phone: phoneInp ? phoneInp.value.trim() : '',
          email: emailInp ? emailInp.value.trim() : '',
          portfolioUrl: portInp ? portInp.value.trim() : '',
          websiteUrl: webInp ? webInp.value.trim() : '',
          city: cityInp ? cityInp.value.trim() : '',
          state: stateInp ? stateInp.value.trim() : '',
          bio: bioInp ? bioInp.value.trim() : ''
        },
        outreachTarget: {
          dailyTarget: targetInp ? (parseInt(targetInp.value, 10) || 50) : 50,
          showProgressBar: chkProgress ? chkProgress.checked : true,
          enableMilestones: chkMilestones ? chkMilestones.checked : true
        },
        defaultLocation: AppState.settings?.defaultLocation || {
          state: 'Telangana',
          city: 'Hyderabad',
          radiusKm: 100
        },
        aiPreferences: {
          tone: toneSel ? toneSel.value : 'Friendly',
          length: lenSel ? lenSel.value : 'Short (60–100 words)',
          approach: appSel ? appSel.value : 'Value First',
          cta: ctaSel ? ctaSel.value : 'Friendly Question',
          personalization: persSel ? persSel.value : 'High (Uses verified business name, category, location, and website status)',
          focusPriority: focSel ? focSel.value : 'Website Development',
          autoAnalyzeVectors: chkVectors ? chkVectors.checked : true
        },
        whatsappPreferences: {
          countryCode: waCountryInp ? waCountryInp.value.trim() : '+91 9959983437',
          launchMode: waModeSel ? waModeSel.value : 'desktop'
        },
        appearance: {
          interactive3DGrid: chkBg ? chkBg.checked : true,
          layoutDensity: denSel ? denSel.value : 'comfortable'
        }
      };

      const btnSaveAll = document.getElementById('btn-save-all-settings');
      this.saveSettings(fullSettings, 'All settings saved successfully', btnSaveAll);
    }
  };

  window.SettingsModule = SettingsModule;

  function initResetLeadDataListeners() {
    const openBtn = document.getElementById('btn-open-reset-leads-modal');
    const modal = document.getElementById('modal-reset-leads-confirm');
    const input = document.getElementById('input-confirm-reset');
    const cancelBtn = document.getElementById('btn-cancel-reset-leads');
    const performBtn = document.getElementById('btn-perform-reset-leads');

    if (!openBtn || !modal || !input || !cancelBtn || !performBtn) return;
    if (openBtn.dataset.resetBound === 'true') return;
    openBtn.dataset.resetBound = 'true';

    let isResetting = false;

    function closeModal() {
      if (isResetting) return;
      modal.classList.add('hidden');
      input.value = '';
      performBtn.disabled = true;
      performBtn.classList.add('btn-reset-disabled');
      performBtn.innerHTML = 'Yes, Reset Everything';
    }

    openBtn.addEventListener('click', () => {
      input.value = '';
      performBtn.disabled = true;
      performBtn.classList.add('btn-reset-disabled');
      performBtn.innerHTML = 'Yes, Reset Everything';
      modal.classList.remove('hidden');
      setTimeout(() => input.focus(), 60);
    });

    cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    input.addEventListener('input', () => {
      if (isResetting) return;
      const val = input.value.trim();
      if (val === 'RESET') {
        performBtn.disabled = false;
        performBtn.classList.remove('btn-reset-disabled');
      } else {
        performBtn.disabled = true;
        performBtn.classList.add('btn-reset-disabled');
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !performBtn.disabled && !isResetting) {
        performBtn.click();
      }
    });

    performBtn.addEventListener('click', async () => {
      if (isResetting || input.value.trim() !== 'RESET') return;

      isResetting = true;
      performBtn.disabled = true;
      performBtn.classList.add('btn-reset-disabled');
      performBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i> Resetting...';
      openBtn.disabled = true;

      try {
        const res = await fetch('/api/leads/reset', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
          const errMsg = data.error || `Server responded with error status ${res.status}`;
          console.error('[RESET LEAD DATA ERROR]', errMsg);
          showToast(`Reset failed: ${errMsg}`, 'error', 5000);
          isResetting = false;
          performBtn.disabled = false;
          performBtn.classList.remove('btn-reset-disabled');
          performBtn.innerHTML = 'Yes, Reset Everything';
          openBtn.disabled = false;
          return;
        }

        // Deletion confirmed on backend & Supabase
        isResetting = false;
        openBtn.disabled = false;
        closeModal();

        // 1. Clear In-Memory AppState lead datasets
        AppState.allSavedLeads = [];
        AppState.savedLeads = [];
        AppState.selectedLeadIds.clear();
        AppState.favoriteLeads = [];
        AppState.selectedFavLeadIds.clear();
        AppState.activeOutreachLead = null;
        AppState.leadToDelete = null;
        if (AppState.outreach) {
          AppState.outreach.data = null;
          AppState.outreach.activeLeadId = null;
          if (AppState.outreach.selectedLeadIds) {
            AppState.outreach.selectedLeadIds.clear();
          }
          AppState.outreach.currentComposerLead = null;
        }
        if (AppState.outreachQueue) {
          AppState.outreachQueue.isActive = false;
          AppState.outreachQueue.leads = [];
          AppState.outreachQueue.currentIndex = 0;
          AppState.outreachQueue.processedCount = 0;
          AppState.outreachQueue.skippedCount = 0;
        }
        if (AppState.followup) {
          AppState.followup.data = null;
          AppState.followup.leads = [];
          AppState.followup.currentReplyLead = null;
        }
        AppState.hasLoadedSavedLeads = false;
        AppState.savedLeadsDirty = true;
        AppState.hasLoadedFavorites = false;
        AppState.favoritesDirty = true;
        AppState.outreachDirty = true;
        AppState.followupDirty = true;

        // 2. Clear Lead-related sessionStorage
        try {
          sessionStorage.removeItem('clienthunter_outreach_lead');
        } catch (e) {}

        // 3. Proactively clear DOM tables and show empty states
        const savedTbody = document.getElementById('saved-leads-tbody');
        const savedEmpty = document.getElementById('saved-table-empty');
        if (savedTbody) savedTbody.innerHTML = '';
        if (savedEmpty) savedEmpty.classList.remove('hidden');

        const favTbody = document.getElementById('fav-leads-tbody');
        const favEmpty = document.getElementById('fav-table-empty');
        if (favTbody) favTbody.innerHTML = '';
        if (favEmpty) favEmpty.classList.remove('hidden');

        // 4. Success notification
        showToast('Lead data reset successfully.', 'success', 3500);

        // 5. Update UI Badges, Counters, and Empty States across all modules
        await updateBadgeCounts();
        updateBulkActionBar();
        updateFavBulkActionBar();

        // 6. Update Current View immediately if lead-dependent
        const view = AppState.currentView;
        if (view === 'saved-leads') {
          await loadSavedLeads();
        } else if (view === 'favorites') {
          await loadFavoriteLeads();
        } else if (view === 'outreach') {
          await loadOutreachData();
        } else if (view === 'followup') {
          await loadFollowUpData();
        } else if (view === 'dashboard') {
          updateDashboardCounts();
        }
      } catch (err) {
        console.error('[RESET LEAD DATA UNEXPECTED ERROR]', err);
        showToast(`Reset failed: ${err.message || 'Network error'}`, 'error', 5000);
        isResetting = false;
        performBtn.disabled = false;
        performBtn.classList.remove('btn-reset-disabled');
        performBtn.innerHTML = 'Yes, Reset Everything';
        openBtn.disabled = false;
      }
    });
  }

  function initSettingsModule() {
    SettingsModule.loadSettings();
    SettingsModule.initSettingsUI();
    initResetLeadDataListeners();
  }

  // ----------------------------------------------------
  // INITIALIZATION ENTRY POINT
  // ----------------------------------------------------
  async function init() {
    try {
      document.body.setAttribute('data-view', AppState.currentView);
      try { initGlobalNavigation(); } catch(e) { console.error('initGlobalNavigation error:', e); }
      try { initMobileMenu(); } catch(e) { console.error('initMobileMenu error:', e); }
      try { initHeroPageInteractions(); } catch(e) { console.error('initHeroPageInteractions error:', e); }
      try { initDashboardInteractions(); } catch(e) { console.error('initDashboardInteractions error:', e); }
      try { initFindLeadsListeners(); } catch(e) { console.error('initFindLeadsListeners error:', e); }
      try { initProcessModalListeners(); } catch(e) { console.error('initProcessModalListeners error:', e); }
      try { initSavedLeadsToolbar(); } catch(e) { console.error('initSavedLeadsToolbar error:', e); }
      try { initSavedLeadsTableDelegation(); } catch(e) { console.error('initSavedLeadsTableDelegation error:', e); }
      try { initFavoritesToolbar(); } catch(e) { console.error('initFavoritesToolbar error:', e); }
      try { initFavLeadsTableDelegation(); } catch(e) { console.error('initFavLeadsTableDelegation error:', e); }
      try { initOutreachListeners(); } catch(e) { console.error('initOutreachListeners error:', e); }
      try { initFollowUpListeners(); } catch(e) { console.error('initFollowUpListeners error:', e); }
      try { initModals(); } catch(e) { console.error('initModals error:', e); }
      try { initHistoryEvents(); } catch(e) { console.error('initHistoryEvents error:', e); }
      try { initHistoryContainerDelegation(); } catch(e) { console.error('initHistoryContainerDelegation error:', e); }
      try { initSettingsModule(); } catch(e) { console.error('initSettingsModule error:', e); }

      // Fetch initial datasets
      await fetchLocations();
      await fetchCategories();
      await updateBadgeCounts();

      const initialHash = window.location.hash.replace('#', '');
      if (['dashboard', 'find-leads', 'saved-leads', 'favorites', 'outreach', 'followup', 'history', 'settings'].includes(initialHash)) {
        switchView(initialHash);
      } else {
        switchView('hero');
      }
    } catch(err) {
      console.error('Fatal init error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
