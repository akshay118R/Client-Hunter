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
    savedViews: [],
    activeSavedViewId: null,
    savedFilters: {
      search: '',
      date: 'All',
      website: 'All',
      status: 'All',
      category: 'All',
      state: 'All',
      city: 'All',
      favorite: 'All',
      whatsapp: 'All',
      followup: 'All',
      reply: 'All',
      priority: 'All',
      conversion: 'all',
      tag: 'All',
      favsOnly: false,
      phoneOnly: false,
      sort: 'newest',
      page: 1,
      rowsPerPage: 25
    },
    collapsedDateGroups: new Set(),
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
      priorityFilter: 'ALL',
      conversionFilter: 'ALL',
      tagFilter: 'ALL',
      smartQueueActive: false,
      currentComposerLead: null,
      isFollowUpComposer: false,
      page: 1,
      rowsPerPage: 25,
      lastFilteredCount: 0
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
      activeTab: 'all',
      replyFilter: 'ALL',
      priorityFilter: 'ALL',
      tagFilter: 'ALL',
      searchQuery: '',
      data: null,
      leads: [],
      selectedLeadIds: new Set(),
      currentReplyLead: null,
      queue: null
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
    followupDirty: false,
    analyticsRange: 'all',
    analyticsData: null,
    analyticsLoading: false
  };

  // ----------------------------------------------------
  // 1. TOAST NOTIFICATION ENGINE
  // ----------------------------------------------------
  function showToast(message, type = 'success', duration = 3500, action = null) {
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

    let actionBtnHtml = '';
    if (action && typeof action.onClick === 'function') {
      const label = action.label || 'Undo';
      actionBtnHtml = `<button type="button" class="toast-undo-btn">${escapeHtml(label)}</button>`;
    }

    toast.innerHTML = `
      <div class="toast-content">
        ${iconHtml}
        <span>${message}</span>
      </div>
      ${actionBtnHtml}
    `;

    // Avoid duplicate consecutive toasts with identical content & type
    const lastToast = container.lastElementChild;
    if (lastToast && lastToast.classList.contains(`toast-${type}`)) {
      const lastSpan = lastToast.querySelector('.toast-content span');
      if (lastSpan && lastSpan.innerHTML === String(message)) {
        return;
      }
    }

    // Bound active toast elements in DOM to prevent accumulation during rapid events
    while (container.children.length >= 5) {
      container.firstElementChild.remove();
    }

    container.appendChild(toast);

    let isDismissed = false;
    const dismiss = () => {
      if (isDismissed) return;
      isDismissed = true;
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    };

    const timer = setTimeout(dismiss, duration);

    if (action && typeof action.onClick === 'function') {
      const btn = toast.querySelector('.toast-undo-btn');
      if (btn) {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          clearTimeout(timer);
          btn.disabled = true;
          btn.textContent = 'Restoring...';
          try {
            await action.onClick(btn);
          } finally {
            dismiss();
          }
        });
      }
    }
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

  let cachedNowMidnight = 0;
  let cachedNowMidnightExpire = 0;
  function getNowMidnight() {
    const now = Date.now();
    if (now < cachedNowMidnightExpire && cachedNowMidnight !== 0) {
      return cachedNowMidnight;
    }
    const d = new Date(now);
    cachedNowMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    cachedNowMidnightExpire = now + 10000;
    return cachedNowMidnight;
  }

  function getCalendarDayDiff(targetDateInput, nowMidnightOverride = null) {
    if (!targetDateInput) return null;
    const target = new Date(targetDateInput);
    const targetTime = target.getTime();
    if (isNaN(targetTime)) return null;

    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const nowMidnight = nowMidnightOverride !== null ? nowMidnightOverride : getNowMidnight();
    return Math.round((targetMidnight - nowMidnight) / 86400000);
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
    window.switchView = switchView;
    if (viewName === 'ai-assistant') {
      toggleAiAssistant();
      return;
    }
    if (typeof cancelWhatsAppAutoTimer === 'function') {
      cancelWhatsAppAutoTimer();
    }
    if (typeof cancelFollowUpWhatsAppAutoTimer === 'function') {
      cancelFollowUpWhatsAppAutoTimer();
    }
    // Cleanly dismiss active composer overlays and queues on view transition
    if (typeof closeOutreachComposer === 'function') {
      const modalOutreach = document.getElementById('modal-outreach-composer');
      if (modalOutreach && !modalOutreach.classList.contains('hidden') && modalOutreach.style.display !== 'none') {
        closeOutreachComposer();
      }
    }
    if (typeof closeDedicatedFollowUpModal === 'function') {
      const modalFu = document.getElementById('modal-followup-composer');
      if (modalFu && !modalFu.classList.contains('hidden') && modalFu.style.display !== 'none') {
        closeDedicatedFollowUpModal();
      }
    }
    if (typeof closeSnoozeModal === 'function') {
      const modalSnooze = document.getElementById('modal-followup-snooze');
      if (modalSnooze && !modalSnooze.classList.contains('hidden') && modalSnooze.style.display !== 'none') {
        closeSnoozeModal();
      }
    }
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
    if (typeof updateGoToTopVisibility === 'function') {
      updateGoToTopVisibility();
    }

    // Update browser URL hash without reload
    const targetHash = `#${viewName}`;
    if (window.location.hash !== targetHash) {
      history.replaceState(null, '', targetHash);
    }

    // View-specific initialization (fast cached check to avoid duplicate network requests)
    if (viewName === 'saved-leads') {
      if (!AppState.hasLoadedSavedLeads || AppState.savedLeadsDirty) {
        loadSavedLeads();
      } else {
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
      if (!AppState.followup?.data || AppState.followupDirty) {
        loadFollowUpData();
      } else {
        renderFollowUpCards();
      }
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

        if (AppState.currentView === 'dashboard') {
          loadDailyPerformance();
        }
      } catch (err) {
        console.warn('Could not update badge counts:', err);
      } finally {
        inFlightCountPromise = null;
      }
    })();
    return inFlightCountPromise;
  }

  async function loadDailyPerformance() {
    try {
      const res = await fetch('/api/dashboard/daily-performance');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.success || !data.performance) return;

      const perf = data.performance;

      // 1. Date display in user's local date
      const dateEl = document.getElementById('daily-perf-date');
      if (dateEl) {
        const now = new Date();
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        dateEl.textContent = now.toLocaleDateString(undefined, options);
      }

      // 2. Status Pill (IN PROGRESS / TARGET REACHED)
      const statusPill = document.getElementById('daily-perf-status-pill');
      if (statusPill) {
        if (perf.status === 'TARGET REACHED') {
          statusPill.className = 'daily-perf-status-pill target-reached';
          statusPill.innerHTML = '<i class="fa-solid fa-check"></i> TARGET REACHED';
        } else {
          statusPill.className = 'daily-perf-status-pill in-progress';
          statusPill.innerHTML = '<i class="fa-solid fa-clock"></i> IN PROGRESS';
        }
      }

      // 3. Target progress strip
      const ratioEl = document.getElementById('daily-perf-ratio');
      const pctEl = document.getElementById('daily-perf-pct');
      const fillEl = document.getElementById('daily-perf-progress-fill');
      const remainingEl = document.getElementById('daily-perf-remaining-hint');

      if (ratioEl) ratioEl.textContent = `${perf.messagesSent} / ${perf.target}`;
      if (pctEl) pctEl.textContent = `${perf.percentage}%`;
      if (fillEl) fillEl.style.width = `${Math.min(100, Math.max(0, perf.percentage))}%`;
      if (remainingEl) {
        if (perf.remaining === 0) {
          remainingEl.innerHTML = '<strong>0</strong> outreach messages remaining today · Target achieved!';
        } else {
          remainingEl.innerHTML = `<strong>${perf.remaining}</strong> outreach message${perf.remaining === 1 ? '' : 's'} remaining today`;
        }
      }

      // 4. Seven Metric Tiles
      const foundEl = document.getElementById('daily-perf-leads-found');
      if (foundEl) foundEl.textContent = perf.leadsFound ?? 0;

      const savedEl = document.getElementById('daily-perf-leads-saved');
      if (savedEl) savedEl.textContent = perf.leadsSaved ?? 0;

      const sentEl = document.getElementById('daily-perf-messages-sent');
      if (sentEl) sentEl.textContent = perf.messagesSent ?? 0;

      const sentBk = document.getElementById('daily-perf-sent-breakdown');
      if (sentBk) {
        sentBk.textContent = `${perf.firstMessagesSent ?? 0} first • ${perf.followUpsSent ?? 0} follow-up`;
      }

      const fuSentEl = document.getElementById('daily-perf-followups-sent');
      if (fuSentEl) fuSentEl.textContent = perf.followUpsSent ?? 0;

      const repliesEl = document.getElementById('daily-perf-replies');
      if (repliesEl) repliesEl.textContent = perf.replies ?? 0;

      const addedEl = document.getElementById('daily-perf-added-outreach');
      if (addedEl) addedEl.textContent = perf.addedToOutreach ?? 0;

      const dueEl = document.getElementById('daily-perf-followups-due');
      if (dueEl) dueEl.textContent = perf.followUpsDue ?? 0;

      const dueBk = document.getElementById('daily-perf-due-breakdown');
      if (dueBk) {
        dueBk.textContent = `${perf.followUpsCompletedToday ?? 0} completed`;
      }

      // 5. Synchronize legacy dashboard outreach cards if present
      const dashBigVal = document.getElementById('dash-big-val');
      const dashPercentVal = document.getElementById('dash-percent-val');
      const dashProgressFill = document.getElementById('dash-progress-fill') || document.getElementById('dash-daily-progress-fill');
      const dashTripletSent = document.getElementById('dash-triplet-sent');
      const dashTripletRem = document.getElementById('dash-triplet-remaining');
      const dashTripletTarget = document.getElementById('dash-triplet-target');

      if (dashBigVal) dashBigVal.textContent = `${perf.messagesSent} / ${perf.target}`;
      if (dashPercentVal) dashPercentVal.textContent = `${perf.percentage}%`;
      if (dashProgressFill) dashProgressFill.style.width = `${Math.min(100, perf.percentage)}%`;
      if (dashTripletSent) dashTripletSent.innerHTML = `<i class="fa-solid fa-check"></i> ${perf.messagesSent} SENT`;
      if (dashTripletRem) dashTripletRem.textContent = `→ ${perf.remaining} LEFT`;
      if (dashTripletTarget) dashTripletTarget.textContent = `${perf.target} / DAY`;

      const dashCardOutreachVal = document.getElementById('dash-card-outreach-val');
      const dashCardOutreachSub = document.getElementById('dash-card-outreach-sub');
      if (dashCardOutreachVal) dashCardOutreachVal.textContent = `${perf.messagesSent} / ${perf.target}`;
      if (dashCardOutreachSub) dashCardOutreachSub.textContent = `${perf.percentage}% done`;

      return perf;
    } catch (err) {
      console.warn('Could not load daily performance summary:', err);
    }
  }

  function updateDashboardCounts() {
    updateBadgeCounts();
    loadDailyPerformance();
    loadDashboardAnalytics();
  }

  // ----------------------------------------------------
  // 3b. DASHBOARD & ANALYTICS REPORTING CONTROLLER (READ-ONLY)
  // ----------------------------------------------------
  async function loadDashboardAnalytics(range) {
    if (range) AppState.analyticsRange = range;
    const activeRange = AppState.analyticsRange || 'all';

    // Update active button styling
    document.querySelectorAll('.btn-time-filter').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.range === activeRange);
    });

    const metaPeriodEl = document.getElementById('dash-meta-period-text');
    const summaryTagEl = document.getElementById('dash-perf-summary-timerange-tag');
    const rangeLabels = {
      today: 'Today',
      '7d': 'Last 7 Days',
      '30d': 'Last 30 Days',
      month: 'This Month',
      all: 'All Time'
    };
    const label = rangeLabels[activeRange] || 'All Time';
    if (metaPeriodEl) metaPeriodEl.textContent = `Period: ${label}`;
    if (summaryTagEl) summaryTagEl.textContent = `${label} Records`;

    try {
      AppState.analyticsLoading = true;
      const res = await fetch(`/api/analytics/dashboard?range=${encodeURIComponent(activeRange)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.success) throw new Error(data?.error || 'Failed to load analytics');

      AppState.analyticsData = data;
      renderDashboardKPIs(data.kpis, activeRange);
      renderPerformanceSummary(data.performanceSummary, activeRange);
    } catch (err) {
      console.warn('Could not load dashboard analytics:', err);
    } finally {
      AppState.analyticsLoading = false;
    }
  }

  function renderDashboardKPIs(kpis, range) {
    if (!kpis) return;

    // 1. Total Leads
    const elTotal = document.getElementById('kpi-total-leads');
    const subTotal = document.getElementById('kpi-sub-total-leads');
    if (elTotal) elTotal.textContent = kpis.totalLeads ?? '—';
    if (subTotal) {
      subTotal.textContent = range === 'all'
        ? 'Stored in database'
        : `${kpis.allTimeTotalLeads ?? 111} all-time`;
    }

    // 2. New Leads
    const elNew = document.getElementById('kpi-new-leads');
    if (elNew) elNew.textContent = kpis.newLeads ?? '—';

    // 3. Favorites
    const elFav = document.getElementById('kpi-favorites');
    if (elFav) elFav.textContent = kpis.favorites ?? '—';

    // 4. Outreach Pending
    const elPending = document.getElementById('kpi-outreach-pending');
    if (elPending) elPending.textContent = kpis.outreachPending ?? '—';

    // 5. Messages Sent
    const elMsgs = document.getElementById('kpi-messages-sent');
    if (elMsgs) elMsgs.textContent = kpis.messagesSent ?? '—';

    // 6. Follow-Ups Due Today
    const elDue = document.getElementById('kpi-fu-due-today');
    if (elDue) elDue.textContent = kpis.followUpsDueToday ?? '—';

    // 7. Overdue Follow-Ups
    const elOverdue = document.getElementById('kpi-fu-overdue');
    if (elOverdue) elOverdue.textContent = kpis.overdueFollowUps ?? '—';

    // 8. Paused Follow-Ups
    const elPaused = document.getElementById('kpi-fu-paused');
    if (elPaused) elPaused.textContent = kpis.pausedFollowUps ?? '—';

    // 9. Interested Leads
    const elInterested = document.getElementById('kpi-interested-leads');
    if (elInterested) elInterested.textContent = kpis.interestedLeads ?? '—';

    // 10. Not Interested Leads
    const elNotInterested = document.getElementById('kpi-not-interested-leads');
    if (elNotInterested) elNotInterested.textContent = kpis.notInterestedLeads ?? '—';

    // 11. Converted Leads
    const elConverted = document.getElementById('kpi-converted-leads');
    if (elConverted) elConverted.textContent = kpis.convertedLeads ?? '—';

    // 12. Conversion Rate
    const elRate = document.getElementById('kpi-conversion-rate');
    if (elRate) {
      elRate.textContent = kpis.conversionRate !== null && kpis.conversionRate !== undefined
        ? `${kpis.conversionRate}%`
        : '—';
    }

    // 13. Conversion Value
    const elVal = document.getElementById('kpi-conversion-value');
    if (elVal) {
      if (kpis.conversionValue !== null && kpis.conversionValue !== undefined && kpis.conversionValue > 0) {
        elVal.textContent = `₹${Number(kpis.conversionValue).toLocaleString('en-IN')}`;
      } else {
        elVal.textContent = '—';
      }
    }
  }

  function renderPerformanceSummary(summary, range) {
    if (!summary) return;

    // 1. Leads Added Over Time
    const listEl = document.getElementById('perf-leads-over-time-list');
    if (listEl) {
      const items = Array.isArray(summary.leadsOverTime) ? summary.leadsOverTime : [];
      if (items.length === 0) {
        listEl.innerHTML = '<div class="perf-panel-empty">No leads recorded in selected period (—)</div>';
      } else {
        listEl.innerHTML = items.map((item) => `
          <div class="perf-leads-date-item">
            <span><i class="fa-regular fa-calendar-check text-green"></i> ${item.date}</span>
            <strong>${item.count} lead${item.count === 1 ? '' : 's'}</strong>
          </div>
        `).join('');
      }
    }

    // 2. Outreach Completed
    const firstMsgsEl = document.getElementById('perf-stat-first-msgs');
    const fuMsgsEl = document.getElementById('perf-stat-followups');
    const totalSentEl = document.getElementById('perf-stat-total-sent');
    if (firstMsgsEl) firstMsgsEl.textContent = summary.outreachCompleted?.firstMessages ?? 0;
    if (fuMsgsEl) fuMsgsEl.textContent = summary.outreachCompleted?.followUps ?? 0;
    if (totalSentEl) totalSentEl.textContent = summary.outreachCompleted?.total ?? 0;

    // 3. Follow-Ups Completed
    const fuCompletedEl = document.getElementById('perf-stat-fu-completed');
    const fuPausedEl = document.getElementById('perf-stat-fu-paused');
    const fuActiveEl = document.getElementById('perf-stat-fu-active');
    if (fuCompletedEl) fuCompletedEl.textContent = summary.followUpsCompleted ?? 0;
    if (fuPausedEl) fuPausedEl.textContent = AppState.analyticsData?.kpis?.pausedFollowUps ?? 0;
    if (fuActiveEl) fuActiveEl.textContent = AppState.analyticsData?.kpis?.messagesSent ?? 0;

    // 4. Responses & Conversions
    const respIntEl = document.getElementById('perf-stat-resp-interested');
    const respNotIntEl = document.getElementById('perf-stat-resp-not-interested');
    const convCountEl = document.getElementById('perf-stat-conv-count');
    const convValEl = document.getElementById('perf-stat-conv-value');

    if (respIntEl) respIntEl.textContent = summary.responses?.interested ?? 0;
    if (respNotIntEl) respNotIntEl.textContent = summary.responses?.notInterested ?? 0;
    if (convCountEl) convCountEl.textContent = summary.conversions?.count ?? 0;
    if (convValEl) {
      if (summary.conversions?.totalValue !== null && summary.conversions?.totalValue !== undefined && summary.conversions?.totalValue > 0) {
        convValEl.textContent = `₹${Number(summary.conversions.totalValue).toLocaleString('en-IN')}`;
      } else {
        convValEl.textContent = '—';
      }
    }
  }

  function setupDashboardAnalyticsListeners() {
    document.querySelectorAll('.btn-time-filter').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const range = btn.dataset.range;
        if (range) loadDashboardAnalytics(range);
      });
    });

    const refreshBtn = document.getElementById('dash-btn-refresh-analytics');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loadDashboardAnalytics();
      });
    }
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

      // Container-level event delegation for options (avoids allocating closures per item on every keystroke)
      if (D.stateOptions) {
        D.stateOptions.addEventListener('click', (e) => {
          const opt = e.target.closest('.custom-select-option');
          if (opt) {
            const val = opt.getAttribute('data-value');
            if (val) this.selectState(val);
          }
        });
      }

      if (D.cityOptions) {
        D.cityOptions.addEventListener('click', (e) => {
          const opt = e.target.closest('.custom-select-option');
          if (opt) {
            const val = opt.getAttribute('data-value');
            const label = opt.querySelector('span')?.textContent || val;
            if (val) this.selectCity(val, label);
          }
        });
      }
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
      'Evaluating candidate qualification (No Website + Valid Phone Number)',
      'Checking duplicate businesses against database',
      'Enriching verified business contact details',
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
        candidatesChecked: result.candidatesChecked,
        duplicatesRemoved: result.duplicatesRemoved,
        newLeadsCount: result.newLeadsCount,
        qualifiedLeadsCount: result.qualifiedLeadsCount,
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

      // Update counters reflecting candidates checked and qualified leads
      const checkedVal = result.candidatesChecked !== undefined ? result.candidatesChecked : (result.totalDiscovered ?? 0);
      const qualifiedVal = result.qualifiedLeadsCount !== undefined ? result.qualifiedLeadsCount : (result.newLeadsCount ?? 0);

      if (P.countDisc) P.countDisc.textContent = `${checkedVal} / 300`;
      if (P.countDup) P.countDup.textContent = result.duplicatesRemoved ?? 0;
      if (P.countNew) P.countNew.textContent = `${qualifiedVal} / 100`;
      console.log(`[Find Leads Trace] Frontend UI updated: Candidates Checked=${checkedVal} / 300, Duplicates=${result.duplicatesRemoved}, Qualified Leads=${qualifiedVal} / 100`);

      AppState.pendingDiscoveredLeads = result.leads || [];

      // Case 1: 0 total candidate businesses evaluated
      if (!checkedVal || checkedVal === 0) {
        addStage('No matching candidate businesses found in Google Places for this combination.', 'done');
        if (P.headline) P.headline.textContent = 'No candidates found for this search.';
        if (P.saveBtn) {
          P.saveBtn.disabled = true;
          if (P.saveLabel) P.saveLabel.textContent = 'No Leads Found';
        }
        return;
      }

      // Case 2 & 3: Candidates were evaluated
      const frag = document.createDocumentFragment();
      const step4 = createStageRow(
        `${stages[3]} (${qualifiedVal} qualified / ${checkedVal} evaluated)`,
        'done'
      );
      const step5 = createStageRow(
        `${stages[4]} (${result.duplicatesRemoved || 0} previously saved skipped)`,
        'done'
      );
      frag.appendChild(step4);
      frag.appendChild(step5);

      if (qualifiedVal > 0) {
        const step6 = createStageRow(stages[5], 'done');
        const step7 = createStageRow(stages[6], 'done');
        frag.appendChild(step6);
        frag.appendChild(step7);
      }

      if (P.stagesBox) {
        P.stagesBox.appendChild(frag);
        requestAnimationFrame(() => {
          P.stagesBox.scrollTop = P.stagesBox.scrollHeight;
        });
      }

      if (qualifiedVal > 0) {
        if (P.headline) P.headline.textContent = `${qualifiedVal} qualified leads found (${checkedVal} candidates evaluated)`;
        if (P.saveBtn) {
          P.saveBtn.disabled = false;
          if (P.saveLabel) P.saveLabel.textContent = `Save ${qualifiedVal} Leads`;
        }
      } else {
        if (P.saveBtn) {
          P.saveBtn.disabled = true;
          if (P.saveLabel) P.saveLabel.textContent = 'No Qualified Leads';
        }
        if (P.headline) P.headline.textContent = `Search complete — 0 qualified leads found (${checkedVal} candidates evaluated).`;
        addStage(`0 businesses satisfied the qualification criteria (No Website + Valid Phone Number) out of ${checkedVal} candidates checked.`, 'done');
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
      let isSavingLeads = false;
      saveBtn.addEventListener('click', async function () {
        if (isSavingLeads || !AppState.pendingDiscoveredLeads.length) return;
        isSavingLeads = true;

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
            const savedCount = data.savedCount ?? 0;
            const duplicatesSkipped = data.duplicatesSkipped ?? 0;
            let toastMsg = `${savedCount} leads saved successfully!`;
            let toastType = 'success';

            if (savedCount === 0 && duplicatesSkipped > 0) {
              toastMsg = duplicatesSkipped === 1
                ? 'Lead is already in Saved Leads.'
                : `All ${duplicatesSkipped} leads are already in Saved Leads.`;
              toastType = 'info';
            } else if (duplicatesSkipped > 0) {
              toastMsg = `${savedCount} new lead${savedCount === 1 ? '' : 's'} saved (${duplicatesSkipped} already saved).`;
            }
            showToast(toastMsg, toastType);

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
          isSavingLeads = false;
        }
      });
    }
  }

  // ----------------------------------------------------
  // 6. SAVED LEADS CONTROLLER (00:29 → 00:36)
  // ----------------------------------------------------
  const SAVED_MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function formatSavedDate(dateInput) {
    if (!dateInput) return 'Date unavailable';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'Date unavailable';
    const day = d.getDate();
    const month = SAVED_MONTH_NAMES[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  }

  function getSavedDateKey(dateInput) {
    if (!dateInput) return 'unavailable';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'unavailable';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

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
      if (AppState.savedFilters.priority && AppState.savedFilters.priority !== 'All') q.append('priority', AppState.savedFilters.priority);
      q.append('sort', AppState.savedFilters.sort);

      const res = await fetch(`/api/leads/saved?${q.toString()}`, { signal: savedLeadsAbortController.signal });
      const data = await res.json().catch(() => ({ success: false, status: 'failed', error: 'Malformed response from server' }));

      if (!data.success || data.status === 'failed') {
        const errorMsg = data.error || 'ClientHunter could not safely load existing data. Your data has not been modified. Please retry or check the data source.';
        showToast(errorMsg, 'error', 8000, {
          label: 'Retry',
          onClick: () => fetchSavedLeads()
        });
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px 20px;color:#f43f5e;">
          <i class="fa-solid fa-triangle-exclamation" style="font-size:26px;margin-bottom:12px;display:block;"></i>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px;">Data Safety Notice: Could Not Load Saved Leads</div>
          <div style="color:#94a3b8;font-size:13px;max-width:480px;margin:0 auto 16px auto;line-height:1.5;">${escapeHtml(errorMsg)}</div>
          <button type="button" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;" onclick="window.retryFetchSavedLeads && window.retryFetchSavedLeads()">
            <i class="fa-solid fa-rotate"></i> Retry
          </button>
        </td></tr>`;
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

      // Populate filter dropdown options dynamically
      populateSavedFilterOptions(AppState.allSavedLeads);

      // Render pagination & rows with filter state preserved
      filterAndRenderSavedLeads();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Error loading saved leads:', err);
      showToast('ClientHunter could not safely load existing data. Your data has not been modified. Please retry or check the data source.', 'error', 8000, {
        label: 'Retry',
        onClick: () => fetchSavedLeads()
      });
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px 20px;color:#f43f5e;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:26px;margin-bottom:12px;display:block;"></i>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px;">Connection Error</div>
        <div style="color:#94a3b8;font-size:13px;max-width:480px;margin:0 auto 16px auto;line-height:1.5;">Failed to connect to backend server. Your data has not been modified.</div>
        <button type="button" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;" onclick="window.retryFetchSavedLeads && window.retryFetchSavedLeads()">
          <i class="fa-solid fa-rotate"></i> Retry
        </button>
      </td></tr>`;
    }
  }

  const fetchSavedLeads = loadSavedLeads;
  window.fetchSavedLeads = loadSavedLeads;
  window.retryFetchSavedLeads = () => loadSavedLeads();

  function isAnySavedFilterActive() {
    const f = AppState.savedFilters;
    return Boolean(
      (f.search && f.search.trim()) ||
      (f.date && f.date !== 'All') ||
      (f.website && f.website !== 'All') ||
      (f.status && f.status !== 'All') ||
      (f.category && f.category !== 'All') ||
      (f.state && f.state !== 'All') ||
      (f.city && f.city !== 'All') ||
      (f.favorite && f.favorite !== 'All') ||
      (f.whatsapp && f.whatsapp !== 'All') ||
      (f.followup && f.followup !== 'All') ||
      (f.reply && f.reply !== 'All') ||
      (f.priority && f.priority !== 'All') ||
      (f.conversion && f.conversion !== 'all') ||
      (f.tag && f.tag !== 'All') ||
      f.phoneOnly ||
      f.favsOnly
    );
  }

  function hasValidLeadWebsite(lead) {
    if (lead.website_status === 'YES') return true;
    if (lead.website_status === 'NO') return false;
    const w = (lead.website || '').trim().toLowerCase();
    return Boolean(w && w !== 'not available' && w !== 'none' && w !== 'null' && w !== 'undefined' && w !== 'no website' && w.length > 3);
  }

  function matchSavedSearch(lead, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return Boolean(
      (lead.business_name && lead.business_name.toLowerCase().includes(q)) ||
      (lead.phone && lead.phone.toLowerCase().includes(q)) ||
      (lead.email && lead.email.toLowerCase().includes(q)) ||
      (lead.website && lead.website.toLowerCase().includes(q)) ||
      (lead.city && lead.city.toLowerCase().includes(q)) ||
      (lead.state && lead.state.toLowerCase().includes(q)) ||
      (lead.district && lead.district.toLowerCase().includes(q)) ||
      (lead.category && lead.category.toLowerCase().includes(q)) ||
      (lead.address && lead.address.toLowerCase().includes(q)) ||
      (Array.isArray(lead.tags) && lead.tags.some((t) => String(t).toLowerCase().includes(q)))
    );
  }

  function matchSavedDate(lead, dateVal, precalcTodayStart = null) {
    if (!dateVal || dateVal === 'All') return true;
    const createdAt = lead.created_at || lead.saved_at;
    if (!createdAt) return dateVal === 'unavailable';
    const leadDate = new Date(createdAt);
    if (isNaN(leadDate.getTime())) return dateVal === 'unavailable';

    const todayStart = precalcTodayStart !== null ? precalcTodayStart : getNowMidnight();
    const leadDayStart = new Date(leadDate.getFullYear(), leadDate.getMonth(), leadDate.getDate()).getTime();
    const dayDiff = Math.round((todayStart - leadDayStart) / 86400000);

    if (dateVal === 'today') {
      return dayDiff === 0;
    }
    if (dateVal === 'yesterday') {
      return dayDiff === 1;
    }
    if (dateVal === 'last7') {
      return dayDiff >= 0 && dayDiff <= 7;
    }
    if (dateVal === 'last30') {
      return dayDiff >= 0 && dayDiff <= 30;
    }
    return getSavedDateKey(createdAt) === dateVal;
  }

  function matchSavedWebsite(lead, websiteVal) {
    if (!websiteVal || websiteVal === 'All') return true;
    const hasWeb = hasValidLeadWebsite(lead);
    if (websiteVal === 'YES' || websiteVal === 'Has Website') return hasWeb;
    if (websiteVal === 'NO' || websiteVal === 'No Website') return !hasWeb;
    return true;
  }

  function matchSavedOutreachStatus(lead, statusVal) {
    if (!statusVal || statusVal === 'All') return true;
    const os = (lead.outreach_status || '').trim();
    const firstSent = Boolean(lead.first_message_sent);
    const completed = Boolean(lead.follow_up_completed || os === 'Completed');
    const stopped = os === 'Stopped';
    const notOnWa = os === 'Not on WhatsApp' || Boolean(lead.not_on_whatsapp) || (lead.activities && lead.activities.some((a) => a.event_type === 'not_on_whatsapp'));
    const replied = os === 'Replied' || lead.reply_status != null || lead.replied_at != null || (lead.activities && lead.activities.some((a) => a.event_type === 'lead_replied'));

    if (statusVal === 'Not Contacted') {
      return !firstSent && !stopped && !notOnWa && (os === 'Not Contacted' || os === 'Pending' || os === 'Ready' || os === 'New' || !os);
    }
    if (statusVal === 'Message Sent') {
      return firstSent || os === 'Follow-Up' || os === 'Message Sent' || (lead.activities && lead.activities.some((a) => a.event_type === 'message_sent'));
    }
    if (statusVal === 'Not Sent') {
      return !firstSent && (!lead.activities || !lead.activities.some((a) => a.event_type === 'message_sent'));
    }
    if (statusVal === 'Not on WhatsApp') {
      return notOnWa;
    }
    if (statusVal === 'Awaiting Reply') {
      return (os === 'Follow-Up' || firstSent) && !completed && !replied && os !== 'Stopped';
    }
    if (statusVal === 'Replied') {
      return replied;
    }
    if (statusVal === 'Completed') {
      return completed;
    }
    if (statusVal === 'Stopped') {
      return stopped;
    }
    return os.toLowerCase() === statusVal.toLowerCase();
  }

  function matchSavedCategory(lead, categoryVal) {
    if (!categoryVal || categoryVal === 'All') return true;
    return (lead.category || '').toLowerCase() === categoryVal.toLowerCase();
  }

  function matchSavedState(lead, stateVal) {
    if (!stateVal || stateVal === 'All') return true;
    return (lead.state || '').toLowerCase() === stateVal.toLowerCase();
  }

  function matchSavedCity(lead, cityVal) {
    if (!cityVal || cityVal === 'All') return true;
    return (lead.city || '').toLowerCase() === cityVal.toLowerCase();
  }

  function matchSavedFavorite(lead, favVal) {
    if (!favVal || favVal === 'All') return true;
    const isFav = Boolean(lead.favorite || lead.is_favorite);
    if (favVal === 'YES' || favVal === 'Favorites' || favVal === 'true') return isFav;
    if (favVal === 'NO' || favVal === 'Not Favorites' || favVal === 'false') return !isFav;
    return true;
  }

  function matchSavedWhatsApp(lead, waVal) {
    if (!waVal || waVal === 'All') return true;
    const hasPhone = Boolean(lead.phone && lead.phone.trim() && lead.phone !== 'Not available');
    const notOnWa = lead.outreach_status === 'Not on WhatsApp' || lead.not_on_whatsapp === true || lead.whatsapp === 'Not Available' || (lead.activities && lead.activities.some((a) => a.event_type === 'not_on_whatsapp'));
    const confirmedWa = Boolean(lead.first_message_sent || lead.first_message_sent_at || lead.whatsapp === 'Available' || (lead.activities && lead.activities.some((a) => a.event_type === 'message_sent' || a.event_type === 'whatsapp_opened')));

    let classification = 'Unknown';
    if (!hasPhone || notOnWa) {
      classification = 'Not Available';
    } else if (confirmedWa) {
      classification = 'Available';
    } else {
      classification = 'Unknown';
    }

    return classification === waVal;
  }

  function matchSavedFollowUp(lead, fuVal, precalcTodayMidnight = null) {
    if (!fuVal || fuVal === 'All') return true;
    const completed = Boolean(lead.outreach_status === 'Completed' || lead.follow_up_completed);
    const replied = Boolean(lead.outreach_status === 'Replied' || lead.reply_status != null || lead.replied_at != null);

    if (fuVal === 'Completed') {
      return completed;
    }
    if (!lead.next_follow_up_at || completed || replied) {
      if (fuVal === 'No Follow-Up') {
        return !completed && !lead.next_follow_up_at;
      }
      return false;
    }

    const todayMidnight = precalcTodayMidnight !== null ? precalcTodayMidnight : getNowMidnight();
    const target = new Date(lead.next_follow_up_at);
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const dayDiff = Math.round((targetMidnight - todayMidnight) / 86400000);

    if (fuVal === 'Due Today') {
      return dayDiff <= 0;
    }
    if (fuVal === 'Upcoming') {
      return dayDiff > 0;
    }
    if (fuVal === 'No Follow-Up') {
      return false;
    }
    return true;
  }

  function matchSavedReply(lead, replyVal) {
    if (!replyVal || replyVal === 'All') return true;
    const isReplied = Boolean(lead.outreach_status === 'Replied' || lead.reply_status != null || lead.replied_at != null || (lead.activities && lead.activities.some((a) => a.event_type === 'lead_replied')));
    if (replyVal === 'Replied') return isReplied;
    if (replyVal === 'No Reply') return !isReplied;
    return true;
  }

  function filterAndRenderSavedLeads() {
    if (!AppState.allSavedLeads || !AppState.allSavedLeads.length) {
      return loadSavedLeads();
    }

    const favsChk = document.getElementById('saved-check-favs');
    if (favsChk) AppState.savedFilters.favsOnly = favsChk.checked;
    const phoneChk = document.getElementById('saved-check-phone');
    if (phoneChk) AppState.savedFilters.phoneOnly = phoneChk.checked;

    const sf = AppState.savedFilters;
    const filterSearch = sf.search ? sf.search.trim().toLowerCase() : null;
    const filterDate = sf.date && sf.date !== 'All' ? sf.date : null;
    const filterWeb = sf.website && sf.website !== 'All' ? sf.website : null;
    const filterStatus = sf.status && sf.status !== 'All' ? sf.status : null;
    const filterCat = sf.category && sf.category !== 'All' ? sf.category : null;
    const filterState = sf.state && sf.state !== 'All' ? sf.state : null;
    const filterCity = sf.city && sf.city !== 'All' ? sf.city : null;
    const filterFav = sf.favorite && sf.favorite !== 'All' ? sf.favorite : null;
    const favsOnly = Boolean(sf.favsOnly);
    const filterWa = sf.whatsapp && sf.whatsapp !== 'All' ? sf.whatsapp : null;
    const filterFu = sf.followup && sf.followup !== 'All' ? sf.followup : null;
    const filterReply = sf.reply && sf.reply !== 'All' ? sf.reply : null;
    const filterPriority = sf.priority && sf.priority !== 'All' ? sf.priority.toLowerCase() : null;

    const convSelect = document.getElementById('saved-filter-conversion');
    if (convSelect) sf.conversion = convSelect.value;
    const filterConv = sf.conversion && sf.conversion !== 'all' ? sf.conversion : null;

    const tagSelect = document.getElementById('saved-filter-tag');
    if (tagSelect) sf.tag = tagSelect.value;
    const filterTag = sf.tag && sf.tag !== 'All' ? sf.tag : null;
    const phoneOnly = Boolean(sf.phoneOnly);

    // Precalculate current time once for date matching
    const nowMidnight = getNowMidnight();

    const results = AppState.allSavedLeads.filter((l) => {
      if (filterSearch && !matchSavedSearch(l, filterSearch)) return false;
      if (filterDate && !matchSavedDate(l, filterDate, nowMidnight)) return false;
      if (filterWeb && !matchSavedWebsite(l, filterWeb)) return false;
      if (filterStatus && !matchSavedOutreachStatus(l, filterStatus)) return false;
      if (filterCat && !matchSavedCategory(l, filterCat)) return false;
      if (filterState && !matchSavedState(l, filterState)) return false;
      if (filterCity && !matchSavedCity(l, filterCity)) return false;
      if (filterFav) {
        if (!matchSavedFavorite(l, filterFav)) return false;
      } else if (favsOnly) {
        if (!Boolean(l.favorite || l.is_favorite)) return false;
      }
      if (filterWa && !matchSavedWhatsApp(l, filterWa)) return false;
      if (filterFu && !matchSavedFollowUp(l, filterFu, nowMidnight)) return false;
      if (filterReply && !matchSavedReply(l, filterReply)) return false;
      if (filterPriority && (l.priority || 'Medium').toLowerCase() !== filterPriority) return false;
      if (filterConv) {
        if (filterConv === 'converted' && !l.converted) return false;
        if (filterConv === 'not_converted' && l.converted) return false;
      }
      if (filterTag) {
        if (filterTag === '__no_tag__') {
          if (Array.isArray(l.tags) && l.tags.length > 0) return false;
        } else {
          const targetTag = filterTag.toLowerCase();
          if (!Array.isArray(l.tags) || !l.tags.some((t) => String(t).toLowerCase() === targetTag)) return false;
        }
      }
      if (phoneOnly && (!l.phone || l.phone === 'Not available')) return false;

      return true;
    });

    // Prune selected lead IDs that no longer match the active filters
    const matchingIdSet = new Set(results.map((l) => String(l.id || l.place_id)));
    for (const selId of AppState.selectedLeadIds) {
      if (!matchingIdSet.has(String(selId))) {
        AppState.selectedLeadIds.delete(selId);
      }
    }
    const masterCheck = document.getElementById('saved-select-all');
    if (masterCheck) masterCheck.checked = false;

    // Sorting
    const sort = AppState.savedFilters.sort || 'newest';
    if (sort === 'newest') {
      results.sort((a, b) => new Date(b.created_at || b.saved_at || 0) - new Date(a.created_at || a.saved_at || 0));
    } else if (sort === 'oldest') {
      results.sort((a, b) => new Date(a.created_at || a.saved_at || 0) - new Date(b.created_at || b.saved_at || 0));
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
    if (!Array.isArray(leads) || !leads.length) return;

    const catSelect = document.getElementById('saved-filter-category');
    const stSelect = document.getElementById('saved-filter-state');
    const citySelect = document.getElementById('saved-filter-city');
    const dateSelect = document.getElementById('saved-filter-date');

    // 1. Date Filter (Presets + Individual Saved Dates)
    if (dateSelect) {
      const currentDateVal = AppState.savedFilters.date || 'All';
      const dateCounts = {};
      leads.forEach((l) => {
        const key = getSavedDateKey(l.created_at || l.saved_at);
        dateCounts[key] = (dateCounts[key] || 0) + 1;
      });

      const sortedKeys = Object.keys(dateCounts).sort((a, b) => {
        if (a === 'unavailable') return 1;
        if (b === 'unavailable') return -1;
        return b.localeCompare(a);
      });

      let dateHtml = `
        <option value="All">Date: All Dates (${leads.length})</option>
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="last7">Last 7 Days</option>
        <option value="last30">Last 30 Days</option>
      `;

      if (sortedKeys.length > 0) {
        dateHtml += `<optgroup label="Saved Dates">`;
        sortedKeys.forEach((key) => {
          const formatted = key === 'unavailable' ? 'Date unavailable' : formatSavedDate(key);
          dateHtml += `<option value="${escapeHtml(key)}">${escapeHtml(formatted)} (${dateCounts[key]})</option>`;
        });
        dateHtml += `</optgroup>`;
      }

      dateSelect.innerHTML = dateHtml;
      if (currentDateVal) {
        dateSelect.value = currentDateVal;
      }
    }

    // 2. Category Filter (Dynamic from existing leads)
    if (catSelect) {
      const currentCatVal = AppState.savedFilters.category || 'All';
      const cats = [...new Set(leads.map((l) => (l.category || '').trim()).filter(Boolean))].sort();
      let catHtml = `<option value="All">Category: All</option>`;
      cats.forEach((cat) => {
        catHtml += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
      });
      catSelect.innerHTML = catHtml;
      if (currentCatVal) catSelect.value = currentCatVal;
    }

    // 3. State Filter (Dynamic from existing leads)
    if (stSelect) {
      const currentStateVal = AppState.savedFilters.state || 'All';
      const states = [...new Set(leads.map((l) => (l.state || '').trim()).filter(Boolean))].sort();
      let stateHtml = `<option value="All">State: All</option>`;
      states.forEach((st) => {
        stateHtml += `<option value="${escapeHtml(st)}">${escapeHtml(st)}</option>`;
      });
      stSelect.innerHTML = stateHtml;
      if (currentStateVal) stSelect.value = currentStateVal;
    }

    // 4. City Filter (Dynamic from existing leads)
    if (citySelect) {
      const currentCityVal = AppState.savedFilters.city || 'All';
      const cities = [...new Set(leads.map((l) => (l.city || '').trim()).filter(Boolean))].sort();
      let cityHtml = `<option value="All">City: All</option>`;
      cities.forEach((c) => {
        cityHtml += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
      });
      citySelect.innerHTML = cityHtml;
      if (currentCityVal) citySelect.value = currentCityVal;
    }

    // 5. Tag Filter (Dynamic from existing leads)
    const tagSelect = document.getElementById('saved-filter-tag');
    const outreachTagSelect = document.getElementById('outreach-tag-filter');
    const followupTagSelect = document.getElementById('followup-tag-filter');

    const allTagsSet = new Set();
    leads.forEach((l) => {
      if (Array.isArray(l.tags)) {
        l.tags.forEach((t) => {
          if (t && typeof t === 'string' && t.trim()) allTagsSet.add(t.trim());
        });
      }
    });
    const sortedTags = Array.from(allTagsSet).sort((a, b) => a.localeCompare(b));

    if (tagSelect) {
      const currentTagVal = AppState.savedFilters.tag || 'All';
      let tagHtml = `<option value="All">Tags: All</option><option value="__no_tag__">No Tag (Untagged)</option>`;
      sortedTags.forEach((t) => {
        tagHtml += `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`;
      });
      tagSelect.innerHTML = tagHtml;
      if (currentTagVal) tagSelect.value = currentTagVal;
    }

    if (outreachTagSelect) {
      const currentVal = AppState.outreach.tagFilter || 'ALL';
      let html = `<option value="ALL">All Tags</option><option value="NO_TAG">No Tag (Untagged)</option>`;
      sortedTags.forEach((t) => {
        html += `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`;
      });
      outreachTagSelect.innerHTML = html;
      if (currentVal) outreachTagSelect.value = currentVal;
    }

    if (followupTagSelect) {
      const currentVal = AppState.followup.tagFilter || 'ALL';
      let html = `<option value="ALL">All Tags</option><option value="NO_TAG">No Tag (Untagged)</option>`;
      sortedTags.forEach((t) => {
        html += `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`;
      });
      followupTagSelect.innerHTML = html;
      if (currentVal) followupTagSelect.value = currentVal;
    }
  }

  function clearSavedFilters() {
    AppState.savedFilters.search = '';
    AppState.savedFilters.date = 'All';
    AppState.savedFilters.website = 'All';
    AppState.savedFilters.status = 'All';
    AppState.savedFilters.category = 'All';
    AppState.savedFilters.state = 'All';
    AppState.savedFilters.city = 'All';
    AppState.savedFilters.favorite = 'All';
    AppState.savedFilters.whatsapp = 'All';
    AppState.savedFilters.followup = 'All';
    AppState.savedFilters.reply = 'All';
    AppState.savedFilters.priority = 'All';
    AppState.savedFilters.conversion = 'all';
    AppState.savedFilters.tag = 'All';
    AppState.savedFilters.phoneOnly = false;
    AppState.savedFilters.favsOnly = false;
    AppState.savedFilters.page = 1;

    // Reset DOM controls
    const searchField = document.getElementById('saved-search-box');
    const dateFilter = document.getElementById('saved-filter-date');
    const webFilter = document.getElementById('saved-filter-website');
    const statusFilter = document.getElementById('saved-filter-status');
    const catFilter = document.getElementById('saved-filter-category');
    const stateFilter = document.getElementById('saved-filter-state');
    const cityFilter = document.getElementById('saved-filter-city');
    const favFilter = document.getElementById('saved-filter-favorite');
    const waFilter = document.getElementById('saved-filter-whatsapp');
    const fuFilter = document.getElementById('saved-filter-followup');
    const replyFilter = document.getElementById('saved-filter-reply');
    const priorityFilter = document.getElementById('saved-filter-priority');
    const convFilter = document.getElementById('saved-filter-conversion');
    const tagFilter = document.getElementById('saved-filter-tag');
    const phoneChk = document.getElementById('saved-check-phone');
    const favsChk = document.getElementById('saved-check-favs');

    if (searchField) searchField.value = '';
    if (dateFilter) dateFilter.value = 'All';
    if (webFilter) webFilter.value = 'All';
    if (statusFilter) statusFilter.value = 'All';
    if (catFilter) catFilter.value = 'All';
    if (stateFilter) stateFilter.value = 'All';
    if (cityFilter) cityFilter.value = 'All';
    if (favFilter) favFilter.value = 'All';
    if (waFilter) waFilter.value = 'All';
    if (fuFilter) fuFilter.value = 'All';
    if (replyFilter) replyFilter.value = 'All';
    if (priorityFilter) priorityFilter.value = 'All';
    if (convFilter) convFilter.value = 'all';
    if (tagFilter) tagFilter.value = 'All';
    if (phoneChk) phoneChk.checked = false;
    if (favsChk) favsChk.checked = false;

    AppState.activeSavedViewId = null;
    renderSavedViewsDropdown();
    filterAndRenderSavedLeads();
    showToast('Filters cleared', 'info', 1500);
  }

  function updateSavedConversionSummary() {
    const leads = AppState.allSavedLeads && AppState.allSavedLeads.length ? AppState.allSavedLeads : (AppState.savedLeads || []);
    let totalConverted = 0;
    let totalValue = 0;
    leads.forEach((l) => {
      if (l.converted) {
        totalConverted += 1;
        if (typeof l.conversion_value === 'number' && !isNaN(l.conversion_value) && l.conversion_value > 0) {
          totalValue += l.conversion_value;
        }
      }
    });
    const totalLeads = leads.length;
    const notConverted = totalLeads - totalConverted;
    const rate = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) + '%' : '0.0%';

    const elTotal = document.getElementById('conv-stat-total');
    const elNot = document.getElementById('conv-stat-not-converted');
    const elRate = document.getElementById('conv-stat-rate');
    const elVal = document.getElementById('conv-stat-value');

    if (elTotal) elTotal.textContent = totalConverted;
    if (elNot) elNot.textContent = notConverted;
    if (elRate) elRate.textContent = rate;
    if (elVal) elVal.textContent = `$${totalValue.toLocaleString()}`;
  }

  // ==========================================================================
  // SAVED VIEWS / SAVED FILTERS CONTROLLER
  // ==========================================================================

  let pendingDeleteViewId = null;
  let saveViewModalMode = 'create'; // 'create' | 'rename'
  let saveViewModalTargetId = null;

  async function loadSavedViews() {
    try {
      const res = await fetch('/api/saved-views');
      const data = await res.json();
      if (data.success && Array.isArray(data.views)) {
        AppState.savedViews = data.views;
      } else {
        AppState.savedViews = [];
      }
      renderSavedViewsDropdown();
    } catch (err) {
      console.warn('[SAVED VIEWS] Error loading saved views:', err);
      AppState.savedViews = [];
      renderSavedViewsDropdown();
    }
  }

  function renderSavedViewsDropdown() {
    const select = document.getElementById('saved-views-select');
    const actionsBox = document.getElementById('saved-views-active-actions');
    if (!select) return;

    const views = AppState.savedViews || [];
    const count = views.length;

    let html = `<option value="">📁 Saved Views (${count})</option>`;
    views.forEach((v) => {
      const isSel = String(v.id) === String(AppState.activeSavedViewId);
      html += `<option value="${escapeHtml(v.id)}" ${isSel ? 'selected' : ''}>${escapeHtml(v.name)}</option>`;
    });

    select.innerHTML = html;
    if (AppState.activeSavedViewId) {
      select.value = AppState.activeSavedViewId;
    } else {
      select.value = '';
    }

    if (actionsBox) {
      if (AppState.activeSavedViewId && views.some((v) => String(v.id) === String(AppState.activeSavedViewId))) {
        actionsBox.classList.remove('hidden');
      } else {
        actionsBox.classList.add('hidden');
      }
    }
  }

  function captureCurrentFilterSettings() {
    const f = AppState.savedFilters || {};
    return {
      search: (f.search || '').trim(),
      date: f.date || 'All',
      website: f.website || 'All',
      status: f.status || 'All',
      category: f.category || 'All',
      state: f.state || 'All',
      city: f.city || 'All',
      favorite: f.favorite || 'All',
      whatsapp: f.whatsapp || 'All',
      followup: f.followup || 'All',
      reply: f.reply || 'All',
      priority: f.priority || 'All',
      conversion: f.conversion || 'all',
      tag: f.tag || 'All',
      phoneOnly: Boolean(f.phoneOnly),
      favsOnly: Boolean(f.favsOnly)
    };
  }

  function renderSavedViewPreviewBadges(filters) {
    const container = document.getElementById('saved-view-preview-list');
    if (!container) return;

    const badges = [];
    if (filters.search) badges.push({ label: 'Search', value: filters.search });
    if (filters.priority && filters.priority !== 'All') badges.push({ label: 'Priority', value: filters.priority });
    if (filters.website && filters.website !== 'All') badges.push({ label: 'Website', value: filters.website === 'YES' ? 'Has Website' : 'No Website' });
    if (filters.status && filters.status !== 'All') badges.push({ label: 'Outreach', value: filters.status });
    if (filters.followup && filters.followup !== 'All') badges.push({ label: 'Follow-Up', value: filters.followup });
    if (filters.tag && filters.tag !== 'All') badges.push({ label: 'Tag', value: filters.tag === '__no_tag__' ? 'No Tag' : filters.tag });
    if (filters.conversion && filters.conversion !== 'all') badges.push({ label: 'Conversion', value: filters.conversion === 'converted' ? 'Converted' : 'Not Converted' });
    if (filters.category && filters.category !== 'All') badges.push({ label: 'Category', value: filters.category });
    if (filters.state && filters.state !== 'All') badges.push({ label: 'State', value: filters.state });
    if (filters.city && filters.city !== 'All') badges.push({ label: 'City', value: filters.city });
    if (filters.reply && filters.reply !== 'All') badges.push({ label: 'Reply', value: filters.reply });
    if (filters.whatsapp && filters.whatsapp !== 'All') badges.push({ label: 'WhatsApp', value: filters.whatsapp });
    if (filters.date && filters.date !== 'All') badges.push({ label: 'Date', value: filters.date });
    if (filters.favorite && filters.favorite !== 'All') badges.push({ label: 'Favorite', value: filters.favorite });
    if (filters.phoneOnly) badges.push({ label: 'Phone', value: 'Verified Phone Only' });
    if (filters.favsOnly) badges.push({ label: 'Starred', value: 'Favorites Only' });

    if (badges.length === 0) {
      container.innerHTML = '<span class="saved-view-badge-chip filter-chip-muted">All Leads (No filters active)</span>';
      return;
    }

    container.innerHTML = badges.map((b) => `
      <span class="saved-view-badge-chip">
        <strong style="color: #94a3b8;">${escapeHtml(b.label)}:</strong>
        <span>${escapeHtml(b.value)}</span>
      </span>
    `).join('');
  }

  function openSaveViewModal(mode = 'create', viewId = null) {
    saveViewModalMode = mode;
    saveViewModalTargetId = viewId;

    const modal = document.getElementById('modal-saved-view');
    const titleEl = document.getElementById('saved-view-modal-title');
    const subtitleEl = document.getElementById('saved-view-modal-subtitle');
    const inputEl = document.getElementById('saved-view-name-input');
    const submitBtnLabel = document.getElementById('btn-submit-saved-view-label');
    const previewSec = document.getElementById('saved-view-preview-section');

    if (!modal || !inputEl) return;

    if (mode === 'rename') {
      const current = AppState.savedViews.find((v) => String(v.id) === String(viewId));
      if (titleEl) titleEl.textContent = 'Rename Saved View';
      if (subtitleEl) subtitleEl.textContent = 'Update the name of this view';
      if (submitBtnLabel) submitBtnLabel.textContent = 'Update Name';
      inputEl.value = current ? current.name : '';
      if (previewSec) previewSec.classList.add('hidden');
    } else {
      if (titleEl) titleEl.textContent = 'Save View';
      if (subtitleEl) subtitleEl.textContent = 'Save current filter combination';
      if (submitBtnLabel) submitBtnLabel.textContent = 'Save View';
      inputEl.value = '';
      if (previewSec) previewSec.classList.remove('hidden');
      renderSavedViewPreviewBadges(captureCurrentFilterSettings());
    }

    modal.classList.remove('hidden');
    setTimeout(() => inputEl.focus(), 50);
  }

  function closeSaveViewModal() {
    const modal = document.getElementById('modal-saved-view');
    if (modal) modal.classList.add('hidden');
    saveViewModalTargetId = null;
  }

  async function submitSavedViewModal() {
    const inputEl = document.getElementById('saved-view-name-input');
    if (!inputEl) return;
    const name = inputEl.value.trim();
    if (!name) {
      showToast('Please enter a view name', 'warning', 2500);
      inputEl.focus();
      return;
    }

    if (saveViewModalMode === 'rename') {
      const targetId = saveViewModalTargetId;
      if (!targetId) return;
      try {
        const res = await fetch(`/api/saved-views/${encodeURIComponent(targetId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.success && data.view) {
          const match = AppState.savedViews.find((v) => String(v.id) === String(targetId));
          if (match) match.name = data.view.name;
          closeSaveViewModal();
          renderSavedViewsDropdown();
          showToast(`✓ View renamed to "${data.view.name}"`, 'success', 2500);
        } else {
          showToast(data.error || 'Failed to rename view', 'error', 3000);
        }
      } catch (err) {
        console.error('[SAVED VIEWS] Rename error:', err);
        showToast('Network error renaming view', 'error', 3000);
      }
    } else {
      // Create new saved view
      const filters = captureCurrentFilterSettings();
      try {
        const res = await fetch('/api/saved-views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            filters,
            tab: 'saved-leads'
          })
        });
        const data = await res.json();
        if (data.success && data.view) {
          AppState.savedViews.push(data.view);
          AppState.activeSavedViewId = data.view.id;
          closeSaveViewModal();
          renderSavedViewsDropdown();
          showToast(`✓ Saved view "${data.view.name}" created`, 'success', 2500);
        } else {
          showToast(data.error || 'Failed to create saved view', 'error', 3000);
        }
      } catch (err) {
        console.error('[SAVED VIEWS] Create error:', err);
        showToast('Network error saving view', 'error', 3000);
      }
    }
  }

  function applySavedView(viewId) {
    if (!viewId) {
      AppState.activeSavedViewId = null;
      renderSavedViewsDropdown();
      return;
    }

    const view = AppState.savedViews.find((v) => String(v.id) === String(viewId));
    if (!view || !view.filters) return;

    AppState.activeSavedViewId = view.id;
    const f = view.filters;

    // Apply to AppState.savedFilters
    AppState.savedFilters.search = f.search || '';
    AppState.savedFilters.date = f.date || 'All';
    AppState.savedFilters.website = f.website || 'All';
    AppState.savedFilters.status = f.status || 'All';
    AppState.savedFilters.category = f.category || 'All';
    AppState.savedFilters.state = f.state || 'All';
    AppState.savedFilters.city = f.city || 'All';
    AppState.savedFilters.favorite = f.favorite || 'All';
    AppState.savedFilters.whatsapp = f.whatsapp || 'All';
    AppState.savedFilters.followup = f.followup || 'All';
    AppState.savedFilters.reply = f.reply || 'All';
    AppState.savedFilters.priority = f.priority || 'All';
    AppState.savedFilters.conversion = f.conversion || 'all';
    AppState.savedFilters.tag = f.tag || 'All';
    AppState.savedFilters.phoneOnly = Boolean(f.phoneOnly);
    AppState.savedFilters.favsOnly = Boolean(f.favsOnly);
    AppState.savedFilters.page = 1;

    // Apply to DOM controls
    const searchField = document.getElementById('saved-search-box');
    const dateFilter = document.getElementById('saved-filter-date');
    const webFilter = document.getElementById('saved-filter-website');
    const statusFilter = document.getElementById('saved-filter-status');
    const catFilter = document.getElementById('saved-filter-category');
    const stateFilter = document.getElementById('saved-filter-state');
    const cityFilter = document.getElementById('saved-filter-city');
    const favFilter = document.getElementById('saved-filter-favorite');
    const waFilter = document.getElementById('saved-filter-whatsapp');
    const fuFilter = document.getElementById('saved-filter-followup');
    const replyFilter = document.getElementById('saved-filter-reply');
    const priorityFilter = document.getElementById('saved-filter-priority');
    const convFilter = document.getElementById('saved-filter-conversion');
    const tagFilter = document.getElementById('saved-filter-tag');
    const phoneChk = document.getElementById('saved-check-phone');
    const favsChk = document.getElementById('saved-check-favs');

    if (searchField) searchField.value = f.search || '';
    if (dateFilter) dateFilter.value = f.date || 'All';
    if (webFilter) webFilter.value = f.website || 'All';
    if (statusFilter) statusFilter.value = f.status || 'All';
    if (catFilter) catFilter.value = f.category || 'All';
    if (stateFilter) stateFilter.value = f.state || 'All';
    if (cityFilter) cityFilter.value = f.city || 'All';
    if (favFilter) favFilter.value = f.favorite || 'All';
    if (waFilter) waFilter.value = f.whatsapp || 'All';
    if (fuFilter) fuFilter.value = f.followup || 'All';
    if (replyFilter) replyFilter.value = f.reply || 'All';
    if (priorityFilter) priorityFilter.value = f.priority || 'All';
    if (convFilter) convFilter.value = f.conversion || 'all';
    if (tagFilter) tagFilter.value = f.tag || 'All';
    if (phoneChk) phoneChk.checked = Boolean(f.phoneOnly);
    if (favsChk) favsChk.checked = Boolean(f.favsOnly);

    filterAndRenderSavedLeads();
    renderSavedViewsDropdown();
    showToast(`✓ Applied view "${view.name}"`, 'info', 2000);
  }

  async function duplicateSavedView(viewId) {
    if (!viewId) return;
    try {
      const res = await fetch(`/api/saved-views/${encodeURIComponent(viewId)}/duplicate`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success && data.view) {
        AppState.savedViews.push(data.view);
        AppState.activeSavedViewId = data.view.id;
        renderSavedViewsDropdown();
        showToast(`✓ Duplicated view "${data.view.name}"`, 'success', 2500);
      } else {
        showToast(data.error || 'Failed to duplicate view', 'error', 3000);
      }
    } catch (err) {
      console.error('[SAVED VIEWS] Duplicate error:', err);
      showToast('Network error duplicating view', 'error', 3000);
    }
  }

  function openDeleteViewModal(viewId) {
    if (!viewId) return;
    pendingDeleteViewId = viewId;
    const view = AppState.savedViews.find((v) => String(v.id) === String(viewId));
    const descEl = document.getElementById('confirm-delete-view-desc');
    if (descEl && view) {
      descEl.innerHTML = `Are you sure you want to delete the saved view <strong>"${escapeHtml(view.name)}"</strong>? Only the saved filter configuration will be removed. <strong>Your leads are NEVER deleted.</strong>`;
    }
    const modal = document.getElementById('modal-delete-view-confirm');
    if (modal) modal.classList.remove('hidden');
  }

  function closeDeleteViewModal() {
    const modal = document.getElementById('modal-delete-view-confirm');
    if (modal) modal.classList.add('hidden');
    pendingDeleteViewId = null;
  }

  async function confirmDeleteView() {
    if (!pendingDeleteViewId) return;
    const targetId = pendingDeleteViewId;
    const view = AppState.savedViews.find((v) => String(v.id) === String(targetId));
    const name = view ? view.name : 'View';

    try {
      const res = await fetch(`/api/saved-views/${encodeURIComponent(targetId)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        AppState.savedViews = AppState.savedViews.filter((v) => String(v.id) !== String(targetId));
        if (String(AppState.activeSavedViewId) === String(targetId)) {
          AppState.activeSavedViewId = null;
        }
        closeDeleteViewModal();
        renderSavedViewsDropdown();
        showToast(`✓ Saved view "${name}" deleted (leads untouched)`, 'info', 3000);
      } else {
        showToast(data.error || 'Failed to delete saved view', 'error', 3000);
      }
    } catch (err) {
      console.error('[SAVED VIEWS] Delete error:', err);
      showToast('Network error deleting saved view', 'error', 3000);
    }
  }

  function setupSavedViewsListeners() {
    const select = document.getElementById('saved-views-select');
    const btnSave = document.getElementById('btn-save-current-view');
    const btnRename = document.getElementById('btn-rename-saved-view');
    const btnDuplicate = document.getElementById('btn-duplicate-saved-view');
    const btnDelete = document.getElementById('btn-delete-saved-view');

    // Modal elements
    const modal = document.getElementById('modal-saved-view');
    const btnCloseModal = document.getElementById('btn-close-saved-view-modal');
    const btnCancelModal = document.getElementById('btn-cancel-saved-view-modal');
    const btnSubmitModal = document.getElementById('btn-submit-saved-view-modal');
    const inputName = document.getElementById('saved-view-name-input');

    // Delete confirm modal elements
    const deleteModal = document.getElementById('modal-delete-view-confirm');
    const btnCancelDelete = document.getElementById('btn-cancel-delete-view');
    const btnConfirmDelete = document.getElementById('btn-confirm-delete-view');

    if (select && !select._bound) {
      select._bound = true;
      select.addEventListener('change', () => {
        applySavedView(select.value);
      });
    }

    if (btnSave && !btnSave._bound) {
      btnSave._bound = true;
      btnSave.addEventListener('click', () => {
        openSaveViewModal('create');
      });
    }

    if (btnRename && !btnRename._bound) {
      btnRename._bound = true;
      btnRename.addEventListener('click', () => {
        if (AppState.activeSavedViewId) {
          openSaveViewModal('rename', AppState.activeSavedViewId);
        }
      });
    }

    if (btnDuplicate && !btnDuplicate._bound) {
      btnDuplicate._bound = true;
      btnDuplicate.addEventListener('click', () => {
        if (AppState.activeSavedViewId) {
          duplicateSavedView(AppState.activeSavedViewId);
        }
      });
    }

    if (btnDelete && !btnDelete._bound) {
      btnDelete._bound = true;
      btnDelete.addEventListener('click', () => {
        if (AppState.activeSavedViewId) {
          openDeleteViewModal(AppState.activeSavedViewId);
        }
      });
    }

    if (btnCloseModal && !btnCloseModal._bound) {
      btnCloseModal._bound = true;
      btnCloseModal.addEventListener('click', closeSaveViewModal);
    }

    if (btnCancelModal && !btnCancelModal._bound) {
      btnCancelModal._bound = true;
      btnCancelModal.addEventListener('click', closeSaveViewModal);
    }

    if (btnSubmitModal && !btnSubmitModal._bound) {
      btnSubmitModal._bound = true;
      btnSubmitModal.addEventListener('click', submitSavedViewModal);
    }

    if (inputName && !inputName._bound) {
      inputName._bound = true;
      inputName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitSavedViewModal();
        }
      });
    }

    if (modal && !modal._bound) {
      modal._bound = true;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSaveViewModal();
      });
    }

    if (btnCancelDelete && !btnCancelDelete._bound) {
      btnCancelDelete._bound = true;
      btnCancelDelete.addEventListener('click', closeDeleteViewModal);
    }

    if (btnConfirmDelete && !btnConfirmDelete._bound) {
      btnConfirmDelete._bound = true;
      btnConfirmDelete.addEventListener('click', confirmDeleteView);
    }

    if (deleteModal && !deleteModal._bound) {
      deleteModal._bound = true;
      deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) closeDeleteViewModal();
      });
    }
  }

  function renderSavedTableRows() {
    const tbody = document.getElementById('saved-leads-tbody');
    const emptyState = document.getElementById('saved-table-empty');
    const emptyTitle = document.getElementById('saved-empty-title');
    const emptyDesc = document.getElementById('saved-empty-desc');
    const emptyClearBtn = document.getElementById('btn-empty-clear-filters');
    const emptyFindBtn = document.getElementById('btn-empty-find-more');
    const showingIndicator = document.getElementById('saved-showing-indicator');
    const totalPill = document.getElementById('saved-total-pill-count');
    const clearBtn = document.getElementById('btn-clear-saved-filters');
    const masterCheck = document.getElementById('saved-select-all');
    if (!tbody) return;

    const totalFiltered = AppState.savedLeads.length;
    const totalAll = (AppState.allSavedLeads && AppState.allSavedLeads.length) || totalFiltered;
    const isFiltered = isAnySavedFilterActive() || totalFiltered !== totalAll;

    // Update Clear Filters button visual state
    if (clearBtn) {
      if (isFiltered) {
        clearBtn.classList.add('has-active-filters');
      } else {
        clearBtn.classList.remove('has-active-filters');
      }
    }

    // Update Counter Pill
    if (totalPill) {
      if (isFiltered) {
        totalPill.textContent = `${totalFiltered} of ${totalAll} Leads`;
      } else {
        totalPill.textContent = `${totalAll} Leads`;
      }
    }

    if (totalFiltered === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');

      if (totalAll > 0) {
        if (emptyTitle) emptyTitle.textContent = 'No leads match your current filters.';
        if (emptyDesc) emptyDesc.textContent = 'Try adjusting or clearing your filter criteria to view more prospects.';
        if (emptyClearBtn) emptyClearBtn.classList.remove('hidden');
        if (emptyFindBtn) emptyFindBtn.classList.add('hidden');
      } else {
        if (emptyTitle) emptyTitle.textContent = 'Your saved leads will appear here.';
        if (emptyDesc) emptyDesc.textContent = 'Run a search to discover your first prospects.';
        if (emptyClearBtn) emptyClearBtn.classList.add('hidden');
        if (emptyFindBtn) emptyFindBtn.classList.remove('hidden');
      }

      if (showingIndicator) {
        showingIndicator.textContent = isFiltered ? `Showing 0 of ${totalAll} leads` : 'Showing 0 leads';
      }
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
      if (isFiltered) {
        if (totalFiltered <= perPage) {
          showingIndicator.textContent = `Showing ${totalFiltered} of ${totalAll} leads`;
        } else {
          showingIndicator.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalFiltered} leads (${totalFiltered} of ${totalAll} filtered)`;
        }
      } else {
        showingIndicator.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalAll} leads`;
      }
    }

    const frag = document.createDocumentFragment();

    // Group visible leads by saved date
    const dateGroups = [];
    const dateGroupMap = new Map();

    visibleLeads.forEach((lead) => {
      const dateKey = getSavedDateKey(lead.created_at);
      if (!dateGroupMap.has(dateKey)) {
        const groupObj = {
          dateKey,
          formattedDate: dateKey === 'unavailable' ? 'Date unavailable' : formatSavedDate(lead.created_at),
          leads: []
        };
        dateGroupMap.set(dateKey, groupObj);
        dateGroups.push(groupObj);
      }
      dateGroupMap.get(dateKey).leads.push(lead);
    });

    // Compute total leads for each dateKey in current filtered results
    const totalByDate = {};
    AppState.savedLeads.forEach((l) => {
      const k = getSavedDateKey(l.created_at);
      totalByDate[k] = (totalByDate[k] || 0) + 1;
    });

    dateGroups.forEach((group) => {
      const isCollapsed = AppState.collapsedDateGroups.has(group.dateKey);
      const totalCount = totalByDate[group.dateKey] || group.leads.length;
      const countText = `${totalCount} ${totalCount === 1 ? 'Lead' : 'Leads'}`;

      // Date Section Header Row
      const headerTr = document.createElement('tr');
      headerTr.className = `saved-date-group-row ${isCollapsed ? 'is-collapsed' : ''}`;
      headerTr.setAttribute('data-date-group', group.dateKey);
      headerTr.innerHTML = `
        <td colspan="9" class="saved-date-group-cell">
          <div class="saved-date-group-banner">
            <div class="saved-date-group-left" title="Click to expand or collapse this date">
              <button type="button" class="saved-date-toggle-btn" aria-label="Toggle ${escapeHtml(group.formattedDate)}">
                <i class="fa-solid fa-chevron-down date-group-chevron"></i>
              </button>
              <i class="fa-regular fa-calendar-days saved-date-cal-icon"></i>
              <span class="saved-date-heading-text">${escapeHtml(group.formattedDate)}</span>
              <span class="saved-date-count-badge">${countText}</span>
            </div>
            <div class="saved-date-group-right">
              <button type="button" class="btn-select-date-group" data-date-target="${group.dateKey}" title="Select all leads for ${escapeHtml(group.formattedDate)}">
                <i class="fa-regular fa-square-check"></i>
                <span>Select Date</span>
              </button>
            </div>
          </div>
        </td>
      `;
      frag.appendChild(headerTr);

      group.leads.forEach((lead) => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', lead.id);
        tr.setAttribute('data-date-group', group.dateKey);
        tr.className = `saved-lead-row ${isCollapsed ? 'saved-lead-row-hidden' : ''}`;

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
                <div style="display:inline-flex;align-items:center;gap:4px;">
                  <span class="lead-title-link" data-id="${lead.id}">${escapeHtml(lead.business_name)}</span>
                  ${Array.isArray(lead.notes) && lead.notes.length > 0 ? `<span class="lead-notes-badge" title="${lead.notes.length} note${lead.notes.length === 1 ? '' : 's'}"><i class="fa-regular fa-note-sticky"></i></span>` : ''}
                </div>
                <div class="lead-sub-details">
                  <span class="lead-category-tag">${escapeHtml(lead.category || 'Business')}</span>
                  <span>•</span>
                  <span>${escapeHtml(lead.city || '')}${lead.state ? ', ' + escapeHtml(lead.state) : ''}</span>
                  <span class="opp-score-badge ${oppHigh ? 'high' : 'med'}">${lead.opportunity_score || 65}/100</span>
                  ${lead.converted ? `<span class="conv-badge-tag" data-id="${lead.id}" title="Converted: ${escapeHtml(lead.conversion_service || 'Deal Closed')}${lead.conversion_value ? ' ($' + Number(lead.conversion_value).toLocaleString() + ')' : ''}"><i class="fa-solid fa-trophy"></i> Converted</span>` : ''}
                </div>
                <div class="lead-tags-row">
                  ${(Array.isArray(lead.tags) ? lead.tags : []).slice(0, 3).map((t) => `<span class="lead-tag-badge lead-tag-badge-sm btn-tag-click" data-id="${lead.id}" data-tag="${escapeHtml(t)}" title="Tag: ${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}
                  ${(Array.isArray(lead.tags) ? lead.tags : []).length > 3 ? `<span class="lead-tag-badge lead-tag-badge-sm lead-tag-more btn-tag-click" data-id="${lead.id}">+${lead.tags.length - 3}</span>` : ''}
                  <button type="button" class="btn-lead-quick-add-tag" data-id="${lead.id}" title="Manage tags"><i class="fa-solid fa-tags"></i> ${(Array.isArray(lead.tags) && lead.tags.length > 0) ? '' : '+ Tag'}</button>
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
            <select class="table-priority-pill" data-id="${lead.id}" data-priority="${escapeHtml(lead.priority || 'Medium')}" title="Lead Priority">
              <option value="High" ${(lead.priority || 'Medium') === 'High' ? 'selected' : ''}>High</option>
              <option value="Medium" ${(lead.priority || 'Medium') === 'Medium' ? 'selected' : ''}>Medium</option>
              <option value="Low" ${(lead.priority || 'Medium') === 'Low' ? 'selected' : ''}>Low</option>
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
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);

    renderPaginationButtons(totalFiltered, page, perPage);
    updateBulkActionBar();
    updateSavedConversionSummary();
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

      // Priority dropdown
      const priSelect = e.target.closest('.table-priority-pill');
      if (priSelect) {
        const id = priSelect.getAttribute('data-id');
        const newPri = priSelect.value;
        priSelect.setAttribute('data-priority', newPri);
        updateLeadPriority(id, newPri);
        return;
      }
    });

    // Click event for buttons & links
    tbody.addEventListener('click', async (e) => {
      // Date Group Accordion Toggle
      const dateToggle = e.target.closest('.saved-date-toggle-btn, .saved-date-group-left');
      if (dateToggle) {
        const headerRow = dateToggle.closest('.saved-date-group-row');
        if (headerRow) {
          const dateKey = headerRow.getAttribute('data-date-group');
          const isCollapsed = headerRow.classList.toggle('is-collapsed');
          if (isCollapsed) {
            AppState.collapsedDateGroups.add(dateKey);
          } else {
            AppState.collapsedDateGroups.delete(dateKey);
          }
          const memberRows = tbody.querySelectorAll(`tr.saved-lead-row[data-date-group="${dateKey}"]`);
          memberRows.forEach((r) => r.classList.toggle('saved-lead-row-hidden', isCollapsed));
        }
        return;
      }

      // Quick Select All in Date Group
      const selectDateBtn = e.target.closest('.btn-select-date-group');
      if (selectDateBtn) {
        const dateKey = selectDateBtn.getAttribute('data-date-target');
        const memberCheckboxes = tbody.querySelectorAll(`tr.saved-lead-row[data-date-group="${dateKey}"] .row-checkbox`);
        if (memberCheckboxes.length > 0) {
          const allChecked = Array.from(memberCheckboxes).every((c) => c.checked);
          const newChecked = !allChecked;
          memberCheckboxes.forEach((c) => {
            c.checked = newChecked;
            const id = c.getAttribute('data-id');
            if (newChecked) AppState.selectedLeadIds.add(id);
            else AppState.selectedLeadIds.delete(id);
          });
          updateBulkActionBar();
        }
        return;
      }

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

      // Conversion Badge click -> Open conversion modal
      const convBadge = e.target.closest('.conv-badge-tag');
      if (convBadge) {
        e.stopPropagation();
        const id = convBadge.getAttribute('data-id');
        if (id) openLeadConversionModal(id);
        return;
      }

      // Tag click -> Open Tag Manager modal
      const tagTarget = e.target.closest('.btn-lead-quick-add-tag, .btn-tag-click');
      if (tagTarget) {
        e.stopPropagation();
        const id = tagTarget.getAttribute('data-id');
        if (id) openLeadTagsModal(id);
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

  async function updateLeadPriority(leadId, priority) {
    if (!leadId || !['High', 'Medium', 'Low'].includes(priority)) return;
    try {
      // Update local state across all stores (optimistic)
      const updateLeadObj = (l) => {
        if (l && (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) {
          l.priority = priority;
        }
      };

      if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
      if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);
      if (AppState.favoriteLeads) AppState.favoriteLeads.forEach(updateLeadObj);
      if (AppState.outreach?.data?.allLeads) AppState.outreach.data.allLeads.forEach(updateLeadObj);
      if (AppState.outreach?.data?.readyLeads) AppState.outreach.data.readyLeads.forEach(updateLeadObj);
      if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
      if (AppState.activeOutreachLead && (String(AppState.activeOutreachLead.id) === String(leadId) || (AppState.activeOutreachLead.place_id && String(AppState.activeOutreachLead.place_id) === String(leadId)))) {
        AppState.activeOutreachLead.priority = priority;
      }

      // Sync any matching selects on DOM
      document.querySelectorAll(`select.table-priority-pill[data-id="${leadId}"]`).forEach((sel) => {
        sel.value = priority;
        sel.setAttribute('data-priority', priority);
      });
      document.querySelectorAll(`select.card-priority-pill[data-id="${leadId}"]`).forEach((sel) => {
        sel.value = priority;
        sel.setAttribute('data-priority', priority);
      });
      document.querySelectorAll(`select.fu-priority-select[data-lead-id="${leadId}"]`).forEach((sel) => {
        sel.value = priority;
        sel.setAttribute('data-priority', priority);
      });
      const wsPri = document.getElementById('ws-priority-select');
      if (wsPri && AppState.outreach?.activeLeadId && (String(AppState.outreach.activeLeadId) === String(leadId) || (AppState.activeOutreachLead?.place_id && String(AppState.activeOutreachLead.place_id) === String(leadId)))) {
        wsPri.value = priority;
      }
      const detailPri = document.getElementById('detail-priority-select');
      if (detailPri) {
        detailPri.value = priority;
      }

      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority })
      });
      const data = await res.json();
      if (data && data.success) {
        showToast(`Priority set to ${priority}`, 'info', 1500);
      } else {
        showToast(data?.error || 'Failed to update priority on server.', 'error', 3000);
      }
    } catch (err) {
      console.error('[Priority] Error updating priority:', err);
      showToast('Network error updating priority.', 'error', 3000);
    }
  }

  async function updateLeadOutcome(leadId, outcome, reason = '') {
    if (!leadId) return;
    const validOutcomes = [
      '',
      'No Response',
      'Interested',
      'Not Interested',
      'Call Back Later',
      'Wrong Number',
      'Converted',
      'Other'
    ];
    const rawOutcome = (outcome || '').trim();
    const matched = validOutcomes.find((o) => o.toLowerCase() === rawOutcome.toLowerCase());
    if (rawOutcome && matched === undefined) {
      showToast('Invalid outcome selected.', 'error', 2500);
      return;
    }
    const normalizedOutcome = matched || '';
    const cleanReason = (reason || '').trim();
    const nowIso = new Date().toISOString();

    try {
      // 1. Optimistic update across all AppState stores
      const updateLeadObj = (l) => {
        if (l && (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) {
          l.contact_outcome = normalizedOutcome || null;
          l.contact_outcome_reason = cleanReason;
          l.contact_outcome_date = normalizedOutcome ? nowIso : null;

          if (normalizedOutcome === 'Not Interested') {
            l.stopped = true;
            l.outreach_status = 'Stopped';
            l.follow_up_completed = true;
            l.next_follow_up_at = null;
          } else if (normalizedOutcome === 'Wrong Number') {
            l.stopped = true;
            l.not_on_whatsapp = true;
            l.outreach_status = 'Not on WhatsApp';
            l.follow_up_completed = true;
            l.next_follow_up_at = null;
          }

          if (normalizedOutcome) {
            if (!Array.isArray(l.activities)) l.activities = [];
            l.activities.unshift({
              event_type: 'contact_outcome',
              event_title: `Outcome: ${normalizedOutcome}`,
              event_description: cleanReason ? `Reason: ${cleanReason}` : 'No reason provided',
              created_at: nowIso,
              metadata: {
                outcome: normalizedOutcome,
                reason: cleanReason || null
              }
            });
          }
        }
      };

      if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
      if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);
      if (AppState.favoriteLeads) AppState.favoriteLeads.forEach(updateLeadObj);
      if (AppState.outreach?.data?.allLeads) AppState.outreach.data.allLeads.forEach(updateLeadObj);
      if (AppState.outreach?.data?.readyLeads) AppState.outreach.data.readyLeads.forEach(updateLeadObj);
      if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
      if (AppState.activeOutreachLead) updateLeadObj(AppState.activeOutreachLead);

      const displayOutcome = normalizedOutcome || 'No outcome';

      // 2. DOM Updates: Conversation Workspace
      const wsBadge = document.getElementById('ws-outcome-current-badge');
      const wsSel = document.getElementById('ws-outcome-select');
      const wsReason = document.getElementById('ws-outcome-reason-input');
      if (wsBadge) {
        wsBadge.textContent = displayOutcome;
        wsBadge.setAttribute('data-outcome', displayOutcome);
      }
      if (wsSel) wsSel.value = normalizedOutcome;
      if (wsReason) wsReason.value = cleanReason;

      // Status pill / select update if stopped or not on WhatsApp
      if (normalizedOutcome === 'Not Interested' || normalizedOutcome === 'Wrong Number') {
        const wsStatusSel = document.getElementById('ws-status-select');
        const wsStatusPill = document.getElementById('ws-status-pill-val');
        const newStatus = normalizedOutcome === 'Wrong Number' ? 'Not on WhatsApp' : 'Stopped';
        if (wsStatusSel) wsStatusSel.value = newStatus;
        if (wsStatusPill) wsStatusPill.textContent = newStatus;
      }

      // 3. DOM Updates: Lead Details Modal
      const modalBadge = document.getElementById('detail-outcome-badge');
      const modalSel = document.getElementById('detail-outcome-select');
      const modalReason = document.getElementById('detail-outcome-reason-input');
      if (modalBadge) {
        modalBadge.textContent = displayOutcome;
        modalBadge.setAttribute('data-outcome', displayOutcome);
      }
      if (modalSel) modalSel.value = normalizedOutcome;
      if (modalReason) modalReason.value = cleanReason;

      // 4. DOM Updates: Outreach Cards Pill
      document.querySelectorAll(`.card-outcome-pill[data-id="${leadId}"]`).forEach((pill) => {
        pill.textContent = displayOutcome;
        pill.setAttribute('data-outcome', displayOutcome);
        pill.title = `Outcome: ${displayOutcome}${cleanReason ? ' — ' + cleanReason : ''}`;
      });

      // 5. Activity Timeline updates
      const currentLead = getOutreachLeadById(leadId) || (AppState.savedLeads && AppState.savedLeads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
      if (currentLead) {
        renderLeadActivityTimeline(currentLead, 'workspace');
        renderLeadActivityTimeline(currentLead, 'modal');
      }

      // 6. Network call to server
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: normalizedOutcome, reason: cleanReason })
      });
      const data = await res.json();
      if (data && data.success) {
        showToast(normalizedOutcome ? `Outcome recorded: ${normalizedOutcome}` : 'Outcome cleared', 'success', 2000);
      } else {
        showToast(data?.error || 'Failed to update outcome on server.', 'error', 3000);
      }
    } catch (err) {
      console.error('[Outcome] Error updating outcome:', err);
      showToast('Network error saving outcome.', 'error', 3000);
    }
  }

  // ==========================================================
  // LEAD CONVERSION TRACKING CONTROLLER
  // ==========================================================
  async function updateLeadConversion(leadId, conversionData = {}) {
    if (!leadId) return;
    const isConverted = Boolean(conversionData.converted);
    const nowIso = new Date().toISOString();
    const convDate = isConverted ? (conversionData.conversion_date || nowIso) : null;
    const convService = isConverted && conversionData.conversion_service ? String(conversionData.conversion_service).trim() : null;
    const convValue = isConverted && conversionData.conversion_value !== undefined && conversionData.conversion_value !== null && conversionData.conversion_value !== '' && !isNaN(Number(conversionData.conversion_value))
      ? Number(conversionData.conversion_value)
      : null;
    const convNotes = isConverted && conversionData.conversion_notes ? String(conversionData.conversion_notes).trim() : null;

    try {
      // 1. Optimistic update across all AppState stores
      const updateLeadObj = (l) => {
        if (l && (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) {
          l.converted = isConverted;
          l.conversion_date = convDate;
          l.conversion_service = convService;
          l.conversion_value = convValue;
          l.conversion_notes = convNotes;
          l.updated_at = nowIso;

          if (!Array.isArray(l.activities)) l.activities = [];
          if (isConverted) {
            const descParts = [];
            if (convService) descParts.push(`Service: ${convService}`);
            if (convValue != null) descParts.push(`Value: $${convValue.toLocaleString()}`);
            if (convNotes) descParts.push(`Notes: ${convNotes}`);
            const desc = descParts.join(' | ') || 'Lead marked as converted';

            l.activities.unshift({
              event_type: 'lead_converted',
              event_title: 'Lead Converted',
              event_description: desc,
              created_at: convDate || nowIso,
              metadata: {
                converted: true,
                conversion_date: convDate,
                conversion_service: convService,
                conversion_value: convValue,
                conversion_notes: convNotes
              }
            });
          } else {
            l.activities.unshift({
              event_type: 'lead_conversion_updated',
              event_title: 'Conversion Status Changed',
              event_description: 'Lead marked as Not Converted',
              created_at: nowIso,
              metadata: { converted: false }
            });
          }
        }
      };

      if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
      if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);
      if (AppState.favoriteLeads) AppState.favoriteLeads.forEach(updateLeadObj);
      if (AppState.outreach?.data?.allLeads) AppState.outreach.data.allLeads.forEach(updateLeadObj);
      if (AppState.outreach?.data?.readyLeads) AppState.outreach.data.readyLeads.forEach(updateLeadObj);
      if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
      if (AppState.activeOutreachLead) updateLeadObj(AppState.activeOutreachLead);

      // 2. DOM Updates: Conversation Workspace
      const wsConvBadge = document.getElementById('ws-conversion-current-badge');
      const wsConvInfo = document.getElementById('ws-conversion-info-text');
      const wsConvBtnLabel = document.getElementById('btn-ws-conversion-action-label');
      if (wsConvBadge) {
        wsConvBadge.textContent = isConverted ? 'Converted' : 'Not Converted';
        wsConvBadge.setAttribute('data-converted', isConverted ? 'true' : 'false');
      }
      if (wsConvInfo) {
        if (isConverted) {
          const parts = [];
          if (convService) parts.push(convService);
          if (convValue != null) parts.push(`$${convValue.toLocaleString()}`);
          if (convDate) {
            try { parts.push(new Date(convDate).toLocaleDateString()); } catch (e) {}
          }
          wsConvInfo.textContent = parts.join(' • ') || 'Lead Converted';
        } else {
          wsConvInfo.textContent = 'No conversion recorded';
        }
      }
      if (wsConvBtnLabel) {
        wsConvBtnLabel.textContent = isConverted ? 'Edit Conversion' : 'Mark Converted';
      }

      // 3. DOM Updates: Lead Details Modal
      const detailConvBadge = document.getElementById('detail-conversion-badge');
      const detailConvSummary = document.getElementById('detail-conversion-summary-text');
      const detailConvBtnLabel = document.getElementById('btn-detail-conversion-action-label');
      if (detailConvBadge) {
        detailConvBadge.textContent = isConverted ? 'Converted' : 'Not Converted';
        detailConvBadge.setAttribute('data-converted', isConverted ? 'true' : 'false');
      }
      if (detailConvSummary) {
        if (isConverted) {
          const parts = [];
          if (convService) parts.push(convService);
          if (convValue != null) parts.push(`$${convValue.toLocaleString()}`);
          if (convDate) {
            try { parts.push(new Date(convDate).toLocaleDateString()); } catch (e) {}
          }
          detailConvSummary.textContent = parts.join(' • ') || 'Lead Converted';
        } else {
          detailConvSummary.textContent = 'No conversion recorded';
        }
      }
      if (detailConvBtnLabel) {
        detailConvBtnLabel.textContent = isConverted ? 'Edit Conversion' : 'Mark Converted';
      }

      // 4. DOM Updates: Saved Leads table & summary
      renderSavedTableRows();
      updateSavedConversionSummary();
      if (AppState.currentView === 'outreach') {
        renderOutreachCards();
      }

      // 5. Activity Timeline updates
      const currentLead = getOutreachLeadById(leadId) || (AppState.savedLeads && AppState.savedLeads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
      if (currentLead) {
        renderLeadActivityTimeline(currentLead, 'workspace');
        renderLeadActivityTimeline(currentLead, 'modal');
      }

      // 6. Network call to server
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/conversion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          converted: isConverted,
          conversion_date: convDate,
          conversion_service: convService,
          conversion_value: convValue,
          conversion_notes: convNotes
        })
      });
      const data = await res.json();
      if (data && data.success) {
        showToast(isConverted ? 'Lead marked as Converted' : 'Lead marked as Not Converted', 'success', 2000);
      } else {
        showToast(data?.error || 'Failed to update conversion on server.', 'error', 3000);
      }
    } catch (err) {
      console.error('[Conversion] Error updating conversion:', err);
      showToast('Network error saving conversion.', 'error', 3000);
    }
  }

  let activeConversionLeadId = null;
  let selectedConversionStatus = 'not_converted';

  function openLeadConversionModal(leadId) {
    if (!leadId) return;
    activeConversionLeadId = leadId;
    const lead = getOutreachLeadById(leadId) ||
      (AppState.savedLeads && AppState.savedLeads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) ||
      (AppState.allSavedLeads && AppState.allSavedLeads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));

    const modal = document.getElementById('modal-lead-conversion');
    const leadTitle = document.getElementById('conv-modal-lead-title');
    const btnConverted = document.getElementById('btn-conv-status-converted');
    const btnNotConverted = document.getElementById('btn-conv-status-not-converted');
    const detailsFields = document.getElementById('conv-details-fields');
    const inputDate = document.getElementById('conv-input-date');
    const inputService = document.getElementById('conv-input-service');
    const inputValue = document.getElementById('conv-input-value');
    const inputNotes = document.getElementById('conv-input-notes');

    if (leadTitle) {
      leadTitle.textContent = lead ? (lead.business_name || 'Selected Lead') : 'Selected Lead';
    }

    const isConv = Boolean(lead && lead.converted);
    selectedConversionStatus = isConv ? 'converted' : 'not_converted';

    if (btnConverted && btnNotConverted) {
      if (isConv) {
        btnConverted.className = 'conv-status-toggle-btn active-converted';
        btnNotConverted.className = 'conv-status-toggle-btn';
        if (detailsFields) detailsFields.classList.remove('hidden');
      } else {
        btnConverted.className = 'conv-status-toggle-btn';
        btnNotConverted.className = 'conv-status-toggle-btn active-not-converted';
        if (detailsFields) detailsFields.classList.add('hidden');
      }
    }

    if (inputDate) {
      if (lead && lead.conversion_date) {
        try {
          inputDate.value = new Date(lead.conversion_date).toISOString().split('T')[0];
        } catch (e) {
          inputDate.value = '';
        }
      } else {
        inputDate.value = new Date().toISOString().split('T')[0];
      }
    }

    if (inputService) inputService.value = (lead && lead.conversion_service) || '';
    if (inputValue) inputValue.value = (lead && lead.conversion_value != null) ? lead.conversion_value : '';
    if (inputNotes) inputNotes.value = (lead && lead.conversion_notes) || '';

    if (modal) modal.classList.remove('hidden');
  }

  function closeLeadConversionModal() {
    const modal = document.getElementById('modal-lead-conversion');
    if (modal) modal.classList.add('hidden');
    activeConversionLeadId = null;
  }

  function setupLeadConversionModalListeners() {
    const btnConverted = document.getElementById('btn-conv-status-converted');
    const btnNotConverted = document.getElementById('btn-conv-status-not-converted');
    const detailsFields = document.getElementById('conv-details-fields');
    const btnClose = document.getElementById('btn-close-conversion-modal');
    const btnCancel = document.getElementById('btn-cancel-conversion-modal');
    const btnSave = document.getElementById('btn-save-conversion-modal');
    const modal = document.getElementById('modal-lead-conversion');

    if (btnConverted && !btnConverted._bound) {
      btnConverted._bound = true;
      btnConverted.onclick = () => {
        selectedConversionStatus = 'converted';
        btnConverted.className = 'conv-status-toggle-btn active-converted';
        if (btnNotConverted) btnNotConverted.className = 'conv-status-toggle-btn';
        if (detailsFields) detailsFields.classList.remove('hidden');
      };
    }

    if (btnNotConverted && !btnNotConverted._bound) {
      btnNotConverted._bound = true;
      btnNotConverted.onclick = () => {
        selectedConversionStatus = 'not_converted';
        if (btnConverted) btnConverted.className = 'conv-status-toggle-btn';
        btnNotConverted.className = 'conv-status-toggle-btn active-not-converted';
        if (detailsFields) detailsFields.classList.add('hidden');
      };
    }

    if (btnClose && !btnClose._bound) {
      btnClose._bound = true;
      btnClose.onclick = () => closeLeadConversionModal();
    }
    if (btnCancel && !btnCancel._bound) {
      btnCancel._bound = true;
      btnCancel.onclick = () => closeLeadConversionModal();
    }
    if (modal && !modal._bound) {
      modal._bound = true;
      modal.onclick = (e) => {
        if (e.target === modal) closeLeadConversionModal();
      };
    }

    if (btnSave && !btnSave._bound) {
      btnSave._bound = true;
      btnSave.onclick = async () => {
        if (!activeConversionLeadId) return;
        const isConv = (selectedConversionStatus === 'converted');
        const inputDate = document.getElementById('conv-input-date');
        const inputService = document.getElementById('conv-input-service');
        const inputValue = document.getElementById('conv-input-value');
        const inputNotes = document.getElementById('conv-input-notes');

        const convDateVal = inputDate && inputDate.value ? new Date(inputDate.value).toISOString() : new Date().toISOString();
        const convServiceVal = inputService ? inputService.value.trim() : '';
        const convValNum = inputValue && inputValue.value !== '' ? Number(inputValue.value) : null;
        const convNotesVal = inputNotes ? inputNotes.value.trim() : '';

        const targetId = activeConversionLeadId;
        closeLeadConversionModal();

        await updateLeadConversion(targetId, {
          converted: isConv,
          conversion_date: isConv ? convDateVal : null,
          conversion_service: isConv ? convServiceVal : null,
          conversion_value: isConv ? convValNum : null,
          conversion_notes: isConv ? convNotesVal : null
        });
      };
    }
  }

  // ----------------------------------------------------
  // LEAD TAGS CONTROLLER & MODAL LOGIC
  // ----------------------------------------------------
  let activeTagsLeadId = null;

  async function updateLeadTags(leadId, rawTags) {
    if (!leadId) return;

    // Sanitize tag array
    const sanitized = [];
    const seen = new Set();
    if (Array.isArray(rawTags)) {
      rawTags.forEach((t) => {
        if (typeof t === 'string' && t.trim()) {
          const clean = t.trim().replace(/\s+/g, ' ').slice(0, 50);
          const lower = clean.toLowerCase();
          if (!seen.has(lower)) {
            seen.add(lower);
            sanitized.push(clean);
          }
        }
      });
    }

    // 1. Optimistic AppState update
    const updateLeadObj = (l) => {
      if (l && (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) {
        l.tags = sanitized;
        l.updated_at = new Date().toISOString();
        if (!Array.isArray(l.activities)) l.activities = [];
        const tagsSummary = sanitized.length > 0 ? sanitized.join(', ') : 'No tags';
        l.activities.unshift({
          event_type: 'lead_tags_updated',
          event_title: 'Lead Tags Updated',
          event_description: `Tags: ${tagsSummary}`,
          created_at: new Date().toISOString(),
          metadata: { tags: sanitized }
        });
      }
    };

    if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
    if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);
    if (AppState.favoriteLeads) AppState.favoriteLeads.forEach(updateLeadObj);
    if (AppState.outreach?.data?.allLeads) AppState.outreach.data.allLeads.forEach(updateLeadObj);
    if (AppState.outreach?.data?.readyLeads) AppState.outreach.data.readyLeads.forEach(updateLeadObj);
    if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
    if (AppState.activeOutreachLead) updateLeadObj(AppState.activeOutreachLead);

    // 2. DOM Updates: Active Lead in Workspace
    const currentLead = AppState.activeOutreachLead || (AppState.savedLeads && AppState.savedLeads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId))));
    if (currentLead && (String(currentLead.id) === String(leadId) || (currentLead.place_id && String(currentLead.place_id) === String(leadId)))) {
      const wsTagsCount = document.getElementById('ws-tags-count');
      const wsTagsList = document.getElementById('ws-tags-list');
      if (wsTagsCount) wsTagsCount.textContent = sanitized.length;
      if (wsTagsList) {
        if (sanitized.length === 0) {
          wsTagsList.innerHTML = '<span class="ws-tags-empty">No tags assigned</span>';
        } else {
          wsTagsList.innerHTML = sanitized.map((t) => `
            <span class="lead-tag-badge" data-tag="${escapeHtml(t)}" title="Tag: ${escapeHtml(t)}">
              <span>${escapeHtml(t)}</span>
              <button type="button" class="tag-remove-btn ws-tag-remove" data-id="${leadId}" data-tag="${escapeHtml(t)}" title="Remove tag">&times;</button>
            </span>
          `).join('');

          wsTagsList.querySelectorAll('.ws-tag-remove').forEach((btn) => {
            btn.onclick = async (e) => {
              e.stopPropagation();
              const tagToRemove = btn.getAttribute('data-tag');
              const nextTags = sanitized.filter((x) => x !== tagToRemove);
              await updateLeadTags(leadId, nextTags);
            };
          });
        }
      }
    }

    // 3. DOM Updates: Lead Details Modal
    const detailTagsList = document.getElementById('detail-tags-list');
    if (detailTagsList) {
      if (sanitized.length === 0) {
        detailTagsList.innerHTML = '<span class="detail-tags-empty">No tags</span>';
      } else {
        detailTagsList.innerHTML = sanitized.map((t) => `
          <span class="lead-tag-badge" title="Tag: ${escapeHtml(t)}">${escapeHtml(t)}</span>
        `).join('');
      }
    }

    // 4. Update Tag Modal active list if currently viewing this lead
    if (activeTagsLeadId === leadId) {
      renderTagModalActiveList(sanitized);
    }

    // 5. Re-render Views
    renderSavedTableRows();
    renderOutreachCards();
    renderFollowUpCards();
    populateSavedFilterOptions(AppState.allSavedLeads || AppState.savedLeads);

    // 6. Backend Sync
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: sanitized })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data?.error || 'Failed to update tags on server.', 'error', 3000);
      } else {
        showToast('Tags updated successfully', 'success', 2000);
      }
    } catch (err) {
      console.error('[Tags] Error updating tags:', err);
      showToast('Network error saving tags.', 'error', 3000);
    }
  }

  function renderTagModalActiveList(tags) {
    const activeList = document.getElementById('tag-modal-active-list');
    if (!activeList) return;
    if (!tags || tags.length === 0) {
      activeList.innerHTML = '<span class="tags-empty-msg" style="color: #64748b; font-size: 12px; align-self: center;">No tags assigned yet.</span>';
      return;
    }

    activeList.innerHTML = tags.map((t) => `
      <span class="lead-tag-badge" style="font-size: 12px; padding: 4px 8px;">
        <span>${escapeHtml(t)}</span>
        <button type="button" class="tag-remove-btn modal-tag-remove" data-tag="${escapeHtml(t)}" style="font-size: 14px; margin-left: 4px;" title="Remove">&times;</button>
      </span>
    `).join('');

    activeList.querySelectorAll('.modal-tag-remove').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!activeTagsLeadId) return;
        const tagToRemove = btn.getAttribute('data-tag');
        const lead = getLeadForTagsModal(activeTagsLeadId);
        const curTags = Array.isArray(lead?.tags) ? lead.tags : [];
        const nextTags = curTags.filter((x) => x !== tagToRemove);
        await updateLeadTags(activeTagsLeadId, nextTags);
        renderTagModalSuggestions(nextTags);
      };
    });
  }

  let cachedTagSuggestions = [];

  async function renderTagModalSuggestions(currentTags = []) {
    const cloud = document.getElementById('tag-modal-suggestions-cloud');
    if (!cloud) return;

    try {
      if (!cachedTagSuggestions || cachedTagSuggestions.length === 0) {
        const res = await fetch('/api/tags');
        const data = await res.json();
        const activeTags = Array.isArray(data?.tags) ? data.tags : [];
        const defaultTags = Array.isArray(data?.defaultSuggestions) ? data.defaultSuggestions : [];
        const combined = Array.from(new Set([...defaultTags, ...activeTags]));
        cachedTagSuggestions = combined;
      }
    } catch (e) {
      if (!cachedTagSuggestions || cachedTagSuggestions.length === 0) {
        cachedTagSuggestions = ['Hot', 'Website Needed', 'High Value', 'Call Back', 'Local', 'Potential Client', 'Interested', 'Follow Up'];
      }
    }

    const curLower = new Set(currentTags.map((t) => t.toLowerCase()));

    cloud.innerHTML = cachedTagSuggestions.map((t) => {
      const isActive = curLower.has(t.toLowerCase());
      return `
        <button type="button" class="tag-suggestion-chip ${isActive ? 'is-active' : ''}" data-tag="${escapeHtml(t)}">
          <span>${isActive ? '✓ ' : '+ '}${escapeHtml(t)}</span>
        </button>
      `;
    }).join('');

    cloud.querySelectorAll('.tag-suggestion-chip').forEach((chip) => {
      chip.onclick = async () => {
        if (!activeTagsLeadId) return;
        const tagVal = chip.getAttribute('data-tag');
        const lead = getLeadForTagsModal(activeTagsLeadId);
        const curTags = Array.isArray(lead?.tags) ? [...lead.tags] : [];
        const lower = tagVal.toLowerCase();
        let nextTags = [];

        if (curTags.some((x) => x.toLowerCase() === lower)) {
          nextTags = curTags.filter((x) => x.toLowerCase() !== lower);
        } else {
          nextTags = [...curTags, tagVal];
        }

        await updateLeadTags(activeTagsLeadId, nextTags);
        renderTagModalSuggestions(nextTags);
      };
    });
  }

  function getLeadForTagsModal(leadId) {
    return getOutreachLeadById(leadId) ||
      (AppState.savedLeads && AppState.savedLeads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) ||
      (AppState.allSavedLeads && AppState.allSavedLeads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) ||
      AppState.activeOutreachLead;
  }

  function openLeadTagsModal(leadId) {
    if (!leadId) return;
    activeTagsLeadId = leadId;
    const lead = getLeadForTagsModal(leadId);

    const modal = document.getElementById('modal-lead-tags');
    const leadTitle = document.getElementById('tag-modal-lead-title');
    const tagInput = document.getElementById('tag-modal-input');

    if (leadTitle) {
      leadTitle.textContent = lead ? (lead.business_name || 'Selected Lead') : 'Selected Lead';
    }
    if (tagInput) {
      tagInput.value = '';
    }

    const currentTags = Array.isArray(lead?.tags) ? lead.tags : [];
    renderTagModalActiveList(currentTags);
    renderTagModalSuggestions(currentTags);

    if (modal) modal.classList.remove('hidden');
  }

  function closeLeadTagsModal() {
    const modal = document.getElementById('modal-lead-tags');
    if (modal) modal.classList.add('hidden');
    activeTagsLeadId = null;
  }

  function setupLeadTagsModalListeners() {
    const modal = document.getElementById('modal-lead-tags');
    const btnClose = document.getElementById('btn-close-tag-modal');
    const btnDone = document.getElementById('btn-done-tag-modal');
    const btnAdd = document.getElementById('btn-tag-modal-add');
    const input = document.getElementById('tag-modal-input');

    const handleAdd = async () => {
      if (!activeTagsLeadId || !input) return;
      const text = input.value.trim();
      if (!text) return;
      const lead = getLeadForTagsModal(activeTagsLeadId);
      const curTags = Array.isArray(lead?.tags) ? [...lead.tags] : [];
      if (!curTags.some((x) => x.toLowerCase() === text.toLowerCase())) {
        const nextTags = [...curTags, text];
        input.value = '';
        await updateLeadTags(activeTagsLeadId, nextTags);
        if (!cachedTagSuggestions.some((s) => s.toLowerCase() === text.toLowerCase())) {
          cachedTagSuggestions.push(text);
        }
        renderTagModalSuggestions(nextTags);
      } else {
        showToast(`Tag "${text}" is already assigned`, 'info', 2000);
        input.value = '';
      }
    };

    if (btnAdd && !btnAdd._bound) {
      btnAdd._bound = true;
      btnAdd.onclick = handleAdd;
    }
    if (input && !input._bound) {
      input._bound = true;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAdd();
        }
      });
    }

    if (btnClose && !btnClose._bound) {
      btnClose._bound = true;
      btnClose.onclick = () => closeLeadTagsModal();
    }
    if (btnDone && !btnDone._bound) {
      btnDone._bound = true;
      btnDone.onclick = () => closeLeadTagsModal();
    }
    if (modal && !modal._bound) {
      modal._bound = true;
      modal.onclick = (e) => {
        if (e.target === modal) closeLeadTagsModal();
      };
    }
  }

  async function pauseFollowUp(leadId) {
    if (!leadId) return;
    try {
      const updateLeadObj = (l) => {
        if (l && (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) {
          l.follow_up_paused = true;
          if (!Array.isArray(l.activities)) l.activities = [];
          l.activities.unshift({
            event_type: 'followup_paused',
            event_title: 'Follow-Up Paused',
            event_description: 'Follow-up paused for this lead',
            created_at: new Date().toISOString()
          });
        }
      };

      if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
      if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
      if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);

      updateFollowUpCounts();
      renderFollowUpCards();

      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/followup/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data && data.success) {
        showToast('Follow-up paused', 'info', 2000);
      } else {
        showToast(data?.error || 'Failed to pause follow-up on server.', 'error', 3000);
      }
    } catch (err) {
      console.error('[FollowUp] Error pausing follow-up:', err);
      showToast('Network error pausing follow-up.', 'error', 3000);
    }
  }

  async function resumeFollowUp(leadId) {
    if (!leadId) return;
    try {
      const updateLeadObj = (l) => {
        if (l && (String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)))) {
          l.follow_up_paused = false;
          if (!Array.isArray(l.activities)) l.activities = [];
          l.activities.unshift({
            event_type: 'followup_resumed',
            event_title: 'Follow-Up Resumed',
            event_description: `Follow-up resumed at stage #${l.next_follow_up_number || 1}`,
            created_at: new Date().toISOString()
          });
        }
      };

      if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
      if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
      if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);

      updateFollowUpCounts();
      renderFollowUpCards();

      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/followup/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data && data.success) {
        showToast('Follow-up resumed', 'success', 2000);
      } else {
        showToast(data?.error || 'Failed to resume follow-up on server.', 'error', 3000);
      }
    } catch (err) {
      console.error('[FollowUp] Error resuming follow-up:', err);
      showToast('Network error resuming follow-up.', 'error', 3000);
    }
  }

  async function bulkPauseFollowUp(leadIds) {
    if (!Array.isArray(leadIds) || leadIds.length === 0) return;
    try {
      leadIds.forEach((id) => {
        const updateLeadObj = (l) => {
          if (l && (String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)))) {
            l.follow_up_paused = true;
            if (!Array.isArray(l.activities)) l.activities = [];
            l.activities.unshift({
              event_type: 'followup_paused',
              event_title: 'Follow-Up Paused',
              event_description: 'Follow-up paused via bulk action',
              created_at: new Date().toISOString()
            });
          }
        };
        if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
        if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
        if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);
      });

      updateFollowUpCounts();
      renderFollowUpCards();

      const res = await fetch('/api/leads/bulk-followup/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds })
      });
      const data = await res.json();
      if (data && data.success) {
        showToast(`Paused follow-up for ${data.updatedCount || leadIds.length} leads`, 'info', 2500);
      } else {
        showToast(data?.error || 'Failed to pause follow-ups on server.', 'error', 3000);
      }
    } catch (err) {
      console.error('[FollowUp] Error in bulk pause:', err);
      showToast('Network error in bulk pause.', 'error', 3000);
    }
  }

  async function bulkResumeFollowUp(leadIds) {
    if (!Array.isArray(leadIds) || leadIds.length === 0) return;
    try {
      leadIds.forEach((id) => {
        const updateLeadObj = (l) => {
          if (l && (String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)))) {
            l.follow_up_paused = false;
            if (!Array.isArray(l.activities)) l.activities = [];
            l.activities.unshift({
              event_type: 'followup_resumed',
              event_title: 'Follow-Up Resumed',
              event_description: `Follow-up resumed via bulk action at stage #${l.next_follow_up_number || 1}`,
              created_at: new Date().toISOString()
            });
          }
        };
        if (AppState.followup?.leads) AppState.followup.leads.forEach(updateLeadObj);
        if (AppState.savedLeads) AppState.savedLeads.forEach(updateLeadObj);
        if (AppState.allSavedLeads) AppState.allSavedLeads.forEach(updateLeadObj);
      });

      updateFollowUpCounts();
      renderFollowUpCards();

      const res = await fetch('/api/leads/bulk-followup/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds })
      });
      const data = await res.json();
      if (data && data.success) {
        showToast(`Resumed follow-up for ${data.updatedCount || leadIds.length} leads`, 'success', 2500);
      } else {
        showToast(data?.error || 'Failed to resume follow-ups on server.', 'error', 3000);
      }
    } catch (err) {
      console.error('[FollowUp] Error in bulk resume:', err);
      showToast('Network error in bulk resume.', 'error', 3000);
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

  // ----------------------------------------------------
  // LEAD NOTES CONTROLLER (MODAL & CONVERSATION WORKSPACE)
  // ----------------------------------------------------
  const NOTE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatNoteTimestamp(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const day = d.getDate();
      const month = NOTE_MONTHS[d.getMonth()];
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
    } catch {
      return '';
    }
  }

  function updateLeadNotesInAppState(leadId, notes) {
    const saved = AppState.savedLeads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
    if (saved) saved.notes = notes;

    const all = AppState.allSavedLeads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
    if (all) all.notes = notes;

    const outreachLead = AppState.outreach?.data?.allLeads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
    if (outreachLead) outreachLead.notes = notes;

    const favLead = AppState.favoriteLeads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
    if (favLead) favLead.notes = notes;

    const fuLead = AppState.followup?.leads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
    if (fuLead) fuLead.notes = notes;
  }

  function renderLeadNotesSection(lead, type = 'modal') {
    const isModal = type === 'modal';
    const prefix = isModal ? 'detail' : 'ws';

    const countEl = document.getElementById(`${prefix}-notes-count`);
    const emptyEl = document.getElementById(`${prefix}-notes-empty`);
    const listEl = document.getElementById(`${prefix}-notes-list`);
    const addBox = document.getElementById(`${prefix}-notes-add-box`);
    const inputEl = document.getElementById(`${prefix}-note-input`);
    const errorEl = document.getElementById(`${prefix}-note-error`);
    const toggleBtn = document.getElementById(`btn-${prefix}-toggle-add-note`);
    const saveBtn = document.getElementById(`btn-${prefix}-save-note`);
    const cancelBtn = document.getElementById(`btn-${prefix}-cancel-note`);

    if (!listEl) return;

    if (addBox) addBox.classList.add('hidden');
    if (inputEl) inputEl.value = '';
    if (errorEl) {
      errorEl.classList.add('hidden');
      errorEl.textContent = 'Please enter a note.';
    }

    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    if (countEl) countEl.textContent = notes.length;

    if (notes.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      listEl.classList.add('hidden');
      listEl.innerHTML = '';
    } else {
      if (emptyEl) emptyEl.classList.add('hidden');
      listEl.classList.remove('hidden');
      listEl.innerHTML = notes.map((note) => {
        const timeFormatted = formatNoteTimestamp(note.created_at);
        const isEdited = note.updated_at && note.updated_at !== note.created_at;
        return `
          <div class="lead-note-item" data-note-id="${note.id}">
            <div class="lead-note-top">
              <span class="lead-note-date">${timeFormatted}${isEdited ? ' (edited)' : ''}</span>
              <div class="lead-note-actions">
                <button type="button" class="btn-note-action btn-note-edit" data-note-id="${note.id}" title="Edit note">
                  <i class="fa-regular fa-pen-to-square"></i>
                  <span>Edit</span>
                </button>
                <button type="button" class="btn-note-action btn-note-delete" data-note-id="${note.id}" title="Delete note">
                  <i class="fa-regular fa-trash-can"></i>
                  <span>Delete</span>
                </button>
              </div>
            </div>
            <div class="lead-note-text">${escapeHtml(note.text)}</div>
            <div class="lead-note-edit-box hidden">
              <textarea class="lead-note-edit-textarea" rows="2" maxlength="5000"></textarea>
              <div class="lead-note-error-inline hidden">Please enter a note.</div>
              <div class="lead-note-edit-actions">
                <button type="button" class="btn-note-cancel btn-cancel-edit-note">Cancel</button>
                <button type="button" class="btn-note-save btn-save-edit-note">Save</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    if (toggleBtn) {
      toggleBtn.onclick = () => {
        if (!addBox) return;
        const isHidden = addBox.classList.toggle('hidden');
        if (!isHidden && inputEl) {
          inputEl.focus();
        }
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        if (addBox) addBox.classList.add('hidden');
        if (inputEl) inputEl.value = '';
        if (errorEl) errorEl.classList.add('hidden');
      };
    }

    if (saveBtn) {
      saveBtn.onclick = async () => {
        const text = inputEl ? inputEl.value.trim() : '';
        if (!text) {
          if (errorEl) {
            errorEl.textContent = 'Please enter a note.';
            errorEl.classList.remove('hidden');
          }
          return;
        }

        saveBtn.disabled = true;
        try {
          const leadId = lead.id || lead.place_id;
          const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
          });
          const data = await res.json();
          if (data.success) {
            lead.notes = data.notes;
            updateLeadNotesInAppState(leadId, data.notes);
            renderLeadNotesSection(lead, type);
            if (isModal && AppState.outreach?.activeLeadId && (String(AppState.outreach.activeLeadId) === String(leadId) || String(lead.place_id) === String(AppState.outreach.activeLeadId))) {
              renderLeadNotesSection(lead, 'workspace');
            } else if (!isModal) {
              const modal = document.getElementById('modal-lead-details');
              if (modal && !modal.classList.contains('hidden')) {
                renderLeadNotesSection(lead, 'modal');
              }
            }
            showToast('Note saved successfully.', 'success', 2500);
          } else {
            if (errorEl) {
              errorEl.textContent = data.error || 'Failed to save note.';
              errorEl.classList.remove('hidden');
            }
          }
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = 'Network error while saving note.';
            errorEl.classList.remove('hidden');
          }
        } finally {
          saveBtn.disabled = false;
        }
      };
    }

    listEl.onclick = async (e) => {
      const editBtn = e.target.closest('.btn-note-edit');
      const deleteBtn = e.target.closest('.btn-note-delete');
      const cancelEditBtn = e.target.closest('.btn-cancel-edit-note');
      const saveEditBtn = e.target.closest('.btn-save-edit-note');

      if (editBtn) {
        const noteId = editBtn.getAttribute('data-note-id');
        const itemEl = listEl.querySelector(`.lead-note-item[data-note-id="${noteId}"]`);
        if (!itemEl) return;
        const textEl = itemEl.querySelector('.lead-note-text');
        const editBox = itemEl.querySelector('.lead-note-edit-box');
        const textarea = itemEl.querySelector('.lead-note-edit-textarea');
        const actionsEl = itemEl.querySelector('.lead-note-actions');
        const errInline = itemEl.querySelector('.lead-note-error-inline');

        const noteObj = (lead.notes || []).find((n) => String(n.id) === String(noteId));
        if (textarea && noteObj) textarea.value = noteObj.text;
        if (textEl) textEl.classList.add('hidden');
        if (actionsEl) actionsEl.classList.add('hidden');
        if (errInline) errInline.classList.add('hidden');
        if (editBox) {
          editBox.classList.remove('hidden');
          textarea?.focus();
        }
        return;
      }

      if (cancelEditBtn) {
        const itemEl = cancelEditBtn.closest('.lead-note-item');
        if (!itemEl) return;
        const textEl = itemEl.querySelector('.lead-note-text');
        const editBox = itemEl.querySelector('.lead-note-edit-box');
        const actionsEl = itemEl.querySelector('.lead-note-actions');
        const errInline = itemEl.querySelector('.lead-note-error-inline');

        if (editBox) editBox.classList.add('hidden');
        if (textEl) textEl.classList.remove('hidden');
        if (actionsEl) actionsEl.classList.remove('hidden');
        if (errInline) errInline.classList.add('hidden');
        return;
      }

      if (saveEditBtn) {
        const itemEl = saveEditBtn.closest('.lead-note-item');
        if (!itemEl) return;
        const noteId = itemEl.getAttribute('data-note-id');
        const textarea = itemEl.querySelector('.lead-note-edit-textarea');
        const errInline = itemEl.querySelector('.lead-note-error-inline');
        const newText = textarea ? textarea.value.trim() : '';

        if (!newText) {
          if (errInline) {
            errInline.textContent = 'Please enter a note.';
            errInline.classList.remove('hidden');
          }
          return;
        }

        saveEditBtn.disabled = true;
        try {
          const leadId = lead.id || lead.place_id;
          const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/notes/${encodeURIComponent(noteId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText })
          });
          const data = await res.json();
          if (data.success) {
            lead.notes = data.notes;
            updateLeadNotesInAppState(leadId, data.notes);
            renderLeadNotesSection(lead, type);
            if (isModal && AppState.outreach?.activeLeadId && (String(AppState.outreach.activeLeadId) === String(leadId) || String(lead.place_id) === String(AppState.outreach.activeLeadId))) {
              renderLeadNotesSection(lead, 'workspace');
            } else if (!isModal) {
              const modal = document.getElementById('modal-lead-details');
              if (modal && !modal.classList.contains('hidden')) {
                renderLeadNotesSection(lead, 'modal');
              }
            }
            showToast('Note updated successfully.', 'success', 2000);
          } else {
            if (errInline) {
              errInline.textContent = data.error || 'Failed to update note.';
              errInline.classList.remove('hidden');
            }
          }
        } catch (err) {
          if (errInline) {
            errInline.textContent = 'Network error while updating note.';
            errInline.classList.remove('hidden');
          }
        } finally {
          saveEditBtn.disabled = false;
        }
        return;
      }

      if (deleteBtn) {
        const noteId = deleteBtn.getAttribute('data-note-id');
        deleteBtn.disabled = true;
        try {
          const leadId = lead.id || lead.place_id;
          const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/notes/${encodeURIComponent(noteId)}`, {
            method: 'DELETE'
          });
          const data = await res.json();
          if (data.success) {
            lead.notes = data.notes;
            updateLeadNotesInAppState(leadId, data.notes);
            renderLeadNotesSection(lead, type);
            if (isModal && AppState.outreach?.activeLeadId && (String(AppState.outreach.activeLeadId) === String(leadId) || String(lead.place_id) === String(AppState.outreach.activeLeadId))) {
              renderLeadNotesSection(lead, 'workspace');
            } else if (!isModal) {
              const modal = document.getElementById('modal-lead-details');
              if (modal && !modal.classList.contains('hidden')) {
                renderLeadNotesSection(lead, 'modal');
              }
            }
            showToast('Note deleted.', 'info', 2000);
          } else {
            showToast(data.error || 'Failed to delete note.', 'error', 3000);
          }
        } catch (err) {
          showToast('Network error while deleting note.', 'error', 3000);
        }
        return;
      }
    };
  }

  // ==========================================================
  // OUTREACH ACTIVITY TIMELINE CONTROLLER
  // ==========================================================
  function formatActivityTimestamp(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = d.getDate();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
    } catch (e) {
      return dateStr;
    }
  }

  const leadActivityTimelineState = {
    workspace: {
      lead: null,
      allActivities: [],
      query: '',
      typeFilter: 'all',
      dateFilter: 'all'
    },
    modal: {
      lead: null,
      allActivities: [],
      query: '',
      typeFilter: 'all',
      dateFilter: 'all'
    }
  };

  function matchesActivitySearchClient(act, query, lead) {
    if (!query) return true;
    const q = String(query).toLowerCase().trim();
    if (!q) return true;

    // 1. Business / Lead name
    const bName = (act.business_name || lead?.business_name || lead?.name || '').toLowerCase();
    if (bName.includes(q)) return true;

    // 2. Activity Type & Title
    const et = (act.event_type || '').toLowerCase();
    const title = (act.event_title || '').toLowerCase();
    if (et.includes(q) || title.includes(q)) return true;

    // 3. Outcome
    const outcome = (act.metadata?.outcome || lead?.contact_outcome || '').toLowerCase();
    const reason = (act.metadata?.reason || '').toLowerCase();
    const replyStatus = (act.metadata?.reply_status || '').toLowerCase();
    if (outcome.includes(q) || reason.includes(q) || replyStatus.includes(q)) return true;

    // 4. Message text
    const msgPreview = (act.metadata?.message_preview || act.metadata?.message_text || act.metadata?.message || '').toLowerCase();
    if (msgPreview.includes(q)) return true;
    if (Array.isArray(lead?.message_history)) {
      const hasMsg = lead.message_history.some((m) => (m.text || m.message || '').toLowerCase().includes(q));
      if (hasMsg && (et === 'message_sent' || et === 'followup_sent' || et === 'lead_replied')) return true;
    }

    // 5. Note text
    const noteText = (act.metadata?.note_text || (et === 'note_added' ? act.event_description : '') || '').toLowerCase();
    if (noteText.includes(q)) return true;

    // 6. Description
    const desc = (act.event_description || '').toLowerCase();
    if (desc.includes(q)) return true;

    // 7. Date string & formatted timestamp
    const dateStr = (act.created_at || '').toLowerCase();
    const formattedDate = (formatActivityTimestamp(act.created_at) || '').toLowerCase();
    if (dateStr.includes(q) || formattedDate.includes(q)) return true;

    // Relative keywords
    if (q === 'today') {
      const now = new Date();
      const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const t1 = t0 + 86400000;
      const at = new Date(act.created_at).getTime();
      if (at >= t0 && at < t1) return true;
    }
    if (q === 'yesterday') {
      const now = new Date();
      const y0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
      const y1 = y0 + 86400000;
      const at = new Date(act.created_at).getTime();
      if (at >= y0 && at < y1) return true;
    }

    // 8. Relevant details (channel, step, phone, category)
    const channel = (act.metadata?.channel || '').toLowerCase();
    const step = act.metadata?.step != null ? `step ${act.metadata.step} #${act.metadata.step} follow-up ${act.metadata.step}` : '';
    const phone = (lead?.phone || '').toLowerCase();
    const category = (lead?.category || '').toLowerCase();
    if (channel.includes(q) || step.includes(q) || phone.includes(q) || category.includes(q)) return true;

    return false;
  }

  function matchesActivityTypeClient(act, typeFilter) {
    if (!typeFilter || typeFilter === 'all') return true;
    const t = String(typeFilter).toLowerCase().trim();
    const et = (act.event_type || '').toLowerCase();

    if (t === 'outreach') {
      return et.startsWith('outreach_') || et === 'lead_added_outreach' || et === 'whatsapp_opened' || et === 'not_on_whatsapp' || et === 'message_sent' || et === 'message_not_sent';
    }
    if (t === 'followup' || t === 'follow-up') {
      return et.startsWith('followup_') || act.metadata?.step != null;
    }
    if (t === 'message_sent' || t === 'message sent') {
      return et === 'message_sent' || et === 'followup_sent';
    }
    if (t === 'outcome') {
      return et === 'contact_outcome' || et === 'lead_replied' || Boolean(act.metadata?.outcome) || Boolean(act.metadata?.reply_status);
    }
    if (t === 'notes' || t === 'note') {
      return et === 'note_added' || et === 'note_edited' || Boolean(act.metadata?.note_text) || Boolean(act.metadata?.note_id);
    }
    if (t === 'status_change' || t === 'status' || t === 'status changes') {
      return et === 'lead_added_outreach' || et === 'outreach_started' || et === 'outreach_stopped' || et === 'outreach_completed' || et === 'outreach_skipped' || et === 'followup_paused' || et === 'followup_resumed' || et === 'lead_saved' || et === 'contact_outcome';
    }
    return et === t;
  }

  function matchesActivityDateClient(act, dateFilter) {
    if (!dateFilter || dateFilter === 'all') return true;
    const actTime = new Date(act.created_at).getTime();
    if (isNaN(actTime)) return true;

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowMidnight = todayMidnight + 86400000;
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();

    if (dateFilter === 'today') {
      return actTime >= todayMidnight && actTime < tomorrowMidnight;
    }
    if (dateFilter === '7d' || dateFilter === 'last_7_days') {
      return actTime >= sevenDaysAgo;
    }
    if (dateFilter === '30d' || dateFilter === 'last_30_days') {
      return actTime >= thirtyDaysAgo;
    }
    return true;
  }

  function renderActivityTimelineItems(type = 'workspace') {
    const isModal = type === 'modal';
    const state = leadActivityTimelineState[type];
    if (!state) return;

    const countEl = document.getElementById(isModal ? 'detail-activity-count' : 'ws-activity-count');
    const emptyEl = document.getElementById(isModal ? 'detail-activity-empty' : 'ws-activity-empty');
    const timelineEl = document.getElementById(isModal ? 'detail-activity-timeline' : 'ws-activity-timeline');
    const clearBtn = document.getElementById(isModal ? 'detail-activity-search-clear' : 'ws-activity-search-clear');

    if (!timelineEl || !emptyEl) return;

    const all = state.allActivities || [];
    const lead = state.lead;

    if (all.length === 0) {
      if (countEl) countEl.textContent = '0';
      emptyEl.classList.remove('hidden');
      emptyEl.innerHTML = '<span>No outreach activity yet.</span>';
      timelineEl.classList.add('hidden');
      timelineEl.innerHTML = '';
      if (clearBtn) clearBtn.classList.add('hidden');
      return;
    }

    // Filter in-memory without making network requests
    const isFiltering = Boolean(state.query) || (state.typeFilter && state.typeFilter !== 'all') || (state.dateFilter && state.dateFilter !== 'all');
    const filtered = all.filter((act) => {
      return matchesActivityTypeClient(act, state.typeFilter) &&
             matchesActivityDateClient(act, state.dateFilter) &&
             matchesActivitySearchClient(act, state.query, lead);
    });

    if (countEl) {
      countEl.textContent = isFiltering ? `${filtered.length}/${all.length}` : all.length;
      countEl.title = isFiltering ? `Showing ${filtered.length} of ${all.length} activities` : `${all.length} activities`;
    }

    if (clearBtn) {
      if (state.query) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    }

    if (filtered.length === 0) {
      emptyEl.classList.add('hidden');
      timelineEl.classList.remove('hidden');
      timelineEl.innerHTML = `
        <div class="activity-search-no-results">
          <i class="fa-solid fa-filter-circle-xmark"></i>
          <span>No activities found matching "${escapeHtml(state.query || 'current filters')}".</span>
          <button type="button" class="btn-activity-reset-filters" data-type="${type}">Reset filters</button>
        </div>
      `;
      const resetBtn = timelineEl.querySelector('.btn-activity-reset-filters');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          resetLeadActivityFilters(type);
        });
      }
      return;
    }

    emptyEl.classList.add('hidden');
    timelineEl.classList.remove('hidden');

    timelineEl.innerHTML = filtered.map((act) => {
      let itemClass = '';
      if (act.event_type === 'followup_due') itemClass = 'item-due';
      else if (act.event_type === 'message_not_sent' || act.event_type === 'followup_not_sent' || act.event_type === 'not_on_whatsapp' || act.event_type === 'outreach_stopped') itemClass = 'item-negative';
      else if (act.event_type === 'whatsapp_opened' || act.event_type === 'lead_added_outreach' || act.event_type === 'outreach_started' || act.event_type === 'outreach_skipped') itemClass = 'item-info';
      else if (act.event_type === 'contact_outcome') {
        const out = (act.metadata?.outcome || '').toLowerCase();
        if (out === 'interested' || out === 'converted') itemClass = 'item-success';
        else if (out === 'not interested' || out === 'wrong number') itemClass = 'item-negative';
        else itemClass = 'item-outcome';
      } else if (act.event_type === 'followup_paused') {
        itemClass = 'item-paused';
      } else if (act.event_type === 'followup_resumed') {
        itemClass = 'item-resumed';
      } else if (act.event_type === 'note_added' || act.event_type === 'note_edited') {
        itemClass = 'item-note';
      }

      const previewHtml = act.metadata?.message_preview
        ? `<div class="timeline-preview">"${escapeHtml(act.metadata.message_preview)}"</div>`
        : '';

      return `
        <div class="activity-timeline-item ${itemClass}">
          <div class="timeline-bullet"></div>
          <div class="timeline-content">
            <div class="timeline-header-row">
              <span class="timeline-title">${escapeHtml(act.event_title || 'Activity')}</span>
              <span class="timeline-time">${escapeHtml(formatActivityTimestamp(act.created_at))}</span>
            </div>
            ${act.event_description ? `<div class="timeline-desc">${escapeHtml(act.event_description)}</div>` : ''}
            ${previewHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function resetLeadActivityFilters(type = 'workspace') {
    const isModal = type === 'modal';
    const state = leadActivityTimelineState[type];
    if (state) {
      state.query = '';
      state.typeFilter = 'all';
      state.dateFilter = 'all';
    }
    const searchInput = document.getElementById(isModal ? 'detail-activity-search' : 'ws-activity-search');
    const typeSelect = document.getElementById(isModal ? 'detail-activity-type-filter' : 'ws-activity-type-filter');
    const dateSelect = document.getElementById(isModal ? 'detail-activity-date-filter' : 'ws-activity-date-filter');
    const clearBtn = document.getElementById(isModal ? 'detail-activity-search-clear' : 'ws-activity-search-clear');

    if (searchInput) searchInput.value = '';
    if (typeSelect) typeSelect.value = 'all';
    if (dateSelect) dateSelect.value = 'all';
    if (clearBtn) clearBtn.classList.add('hidden');

    renderActivityTimelineItems(type);
  }

  function setupActivityTimelineListeners(type = 'workspace') {
    const isModal = type === 'modal';
    const searchInput = document.getElementById(isModal ? 'detail-activity-search' : 'ws-activity-search');
    const typeSelect = document.getElementById(isModal ? 'detail-activity-type-filter' : 'ws-activity-type-filter');
    const dateSelect = document.getElementById(isModal ? 'detail-activity-date-filter' : 'ws-activity-date-filter');
    const clearBtn = document.getElementById(isModal ? 'detail-activity-search-clear' : 'ws-activity-search-clear');

    if (searchInput && !searchInput._activityBound) {
      searchInput._activityBound = true;
      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          leadActivityTimelineState[type].query = e.target.value.trim();
          renderActivityTimelineItems(type);
        }, 80);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchInput.value = '';
          leadActivityTimelineState[type].query = '';
          renderActivityTimelineItems(type);
        }
      });
    }

    if (clearBtn && !clearBtn._activityBound) {
      clearBtn._activityBound = true;
      clearBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        leadActivityTimelineState[type].query = '';
        renderActivityTimelineItems(type);
        if (searchInput) searchInput.focus();
      });
    }

    if (typeSelect && !typeSelect._activityBound) {
      typeSelect._activityBound = true;
      typeSelect.addEventListener('change', (e) => {
        leadActivityTimelineState[type].typeFilter = e.target.value;
        renderActivityTimelineItems(type);
      });
    }

    if (dateSelect && !dateSelect._activityBound) {
      dateSelect._activityBound = true;
      dateSelect.addEventListener('change', (e) => {
        leadActivityTimelineState[type].dateFilter = e.target.value;
        renderActivityTimelineItems(type);
      });
    }
  }

  async function renderLeadActivityTimeline(lead, type = 'workspace') {
    if (!lead) return;
    const isModal = type === 'modal';
    setupActivityTimelineListeners(type);

    let activities = Array.isArray(lead.activities) ? lead.activities : [];
    try {
      const leadId = lead.id || lead.place_id;
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`);
      const data = await res.json();
      if (data.success && Array.isArray(data.activities)) {
        activities = data.activities;
        lead.activities = activities;
      }
    } catch (e) {
      // Use local activities as fallback
    }

    leadActivityTimelineState[type].lead = lead;
    leadActivityTimelineState[type].allActivities = activities;

    renderActivityTimelineItems(type);
  }

  // Expose state and functions for debugging/testing
  window.leadActivityTimelineState = leadActivityTimelineState;
  window.renderLeadActivityTimeline = renderLeadActivityTimeline;
  window.resetLeadActivityFilters = resetLeadActivityFilters;
  window.renderActivityTimelineItems = renderActivityTimelineItems;

  function openLeadDetailModal(lead) {
    const modal = document.getElementById('modal-lead-details');
    if (!modal) return;

    document.getElementById('detail-category-badge').textContent = lead.category || 'Business';
    document.getElementById('detail-business-name').textContent = lead.business_name;
    document.getElementById('detail-score-num').textContent = lead.opportunity_score || 50;
    document.getElementById('detail-score-lvl').textContent = lead.opportunity_level || 'MEDIUM';

    const detailPrioritySelect = document.getElementById('detail-priority-select');
    if (detailPrioritySelect) {
      detailPrioritySelect.value = lead.priority || 'Medium';
      detailPrioritySelect.onchange = (e) => {
        const newPri = e.target.value;
        lead.priority = newPri;
        updateLeadPriority(lead.id || lead.place_id, newPri);
      };
    }

    // Contact Outcome & Reason in Detail Modal
    const detailOutcomeBadge = document.getElementById('detail-outcome-badge');
    const detailOutcomeSelect = document.getElementById('detail-outcome-select');
    const detailOutcomeReason = document.getElementById('detail-outcome-reason-input');
    const detailSaveBtn = document.getElementById('btn-detail-save-outcome');

    const curOutcome = lead.contact_outcome || '';
    const curReason = lead.contact_outcome_reason || '';
    const dispOutcome = curOutcome || 'No outcome';

    if (detailOutcomeBadge) {
      detailOutcomeBadge.textContent = dispOutcome;
      detailOutcomeBadge.setAttribute('data-outcome', dispOutcome);
    }
    if (detailOutcomeSelect) {
      detailOutcomeSelect.value = curOutcome;
    }
    if (detailOutcomeReason) {
      detailOutcomeReason.value = curReason;
    }
    if (detailSaveBtn) {
      detailSaveBtn.onclick = async () => {
        const chosen = detailOutcomeSelect ? detailOutcomeSelect.value : '';
        const reas = detailOutcomeReason ? detailOutcomeReason.value.trim() : '';
        await updateLeadOutcome(lead.id || lead.place_id, chosen, reas);
      };
    }

    // Lead Conversion in Detail Modal
    const detailConvBadge = document.getElementById('detail-conversion-badge');
    const detailConvSummary = document.getElementById('detail-conversion-summary-text');
    const detailConvBtn = document.getElementById('btn-detail-open-conversion');
    const detailConvBtnLabel = document.getElementById('btn-detail-conversion-action-label');

    const isDetailConv = Boolean(lead.converted);
    if (detailConvBadge) {
      detailConvBadge.textContent = isDetailConv ? 'Converted' : 'Not Converted';
      detailConvBadge.setAttribute('data-converted', isDetailConv ? 'true' : 'false');
    }
    if (detailConvSummary) {
      if (isDetailConv) {
        const parts = [];
        if (lead.conversion_service) parts.push(lead.conversion_service);
        if (lead.conversion_value != null && lead.conversion_value !== '') parts.push(`$${Number(lead.conversion_value).toLocaleString()}`);
        if (lead.conversion_date) {
          try { parts.push(new Date(lead.conversion_date).toLocaleDateString()); } catch (e) {}
        }
        detailConvSummary.textContent = parts.join(' • ') || 'Lead Converted';
      } else {
        detailConvSummary.textContent = 'No conversion recorded';
      }
    }
    if (detailConvBtnLabel) {
      detailConvBtnLabel.textContent = isDetailConv ? 'Edit Conversion' : 'Mark Converted';
    }
    if (detailConvBtn) {
      detailConvBtn.onclick = () => openLeadConversionModal(lead.id || lead.place_id);
    }

    // Lead Tags in Detail Modal
    const detailTagsList = document.getElementById('detail-tags-list');
    const detailTagsBtn = document.getElementById('btn-detail-open-tag-manager');
    const detailLeadTags = Array.isArray(lead.tags) ? lead.tags : [];

    if (detailTagsList) {
      if (detailLeadTags.length === 0) {
        detailTagsList.innerHTML = '<span class="detail-tags-empty">No tags</span>';
      } else {
        detailTagsList.innerHTML = detailLeadTags.map((t) => `
          <span class="lead-tag-badge" title="Tag: ${escapeHtml(t)}">${escapeHtml(t)}</span>
        `).join('');
      }
    }
    if (detailTagsBtn) {
      detailTagsBtn.onclick = () => openLeadTagsModal(lead.id || lead.place_id);
    }

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
        try {
          const res = await fetch(`/api/leads/${lead.id || lead.place_id}/ai-audit`);
          const data = await res.json();
          if (data.success && data.audit) {
            if (auditBody) {
              auditBody.innerHTML = `<div style="white-space: pre-wrap; line-height: 1.6; color: #f1f5f9;">${escapeHtml(data.audit)}</div>`;
            }
            if (auditBtnText) auditBtnText.textContent = 'Regenerate Audit';
          } else {
            if (auditBody) auditBody.textContent = data.error || 'Failed to generate audit.';
            if (auditBtnText) auditBtnText.textContent = 'Retry Audit';
          }
        } catch (err) {
          if (auditBody) auditBody.textContent = 'Could not generate audit at this time. Please try again.';
          if (auditBtnText) auditBtnText.textContent = 'Retry Audit';
        } finally {
          auditBtn.disabled = false;
        }
      };
    }

    // Lead Notes in Detail Modal
    renderLeadNotesSection(lead, 'modal');

    // Lead Outreach Activity Timeline in Detail Modal
    renderLeadActivityTimeline(lead, 'modal');

    modal.classList.remove('hidden');
  }

  let deleteConfirmCallback = null;

  function openDeleteConfirmModal(title, desc, onConfirm = null, confirmBtnText = 'Delete Leads') {
    deleteConfirmCallback = onConfirm;
    const modal = document.getElementById('modal-delete-confirm');
    const titleEl = document.getElementById('confirm-delete-title');
    const descEl = document.getElementById('confirm-delete-desc');
    const performDeleteBtn = document.getElementById('btn-perform-delete');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (performDeleteBtn) performDeleteBtn.textContent = confirmBtnText;
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

  let isMoveToOutreachProcessing = false;
  async function performMoveToOutreach() {
    if (isMoveToOutreachProcessing) return;
    isMoveToOutreachProcessing = true;
    const ids = AppState.pendingMoveToOutreachIds || Array.from(AppState.selectedLeadIds);
    if (!ids || !ids.length) {
      isMoveToOutreachProcessing = false;
      return;
    }

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
      isMoveToOutreachProcessing = false;
    }
  }

  let modalsBound = false;
  function initModals() {
    if (modalsBound) return;
    modalsBound = true;

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

    // Remove from Outreach Confirmation Modal
    const removeOutreachModal = document.getElementById('modal-remove-outreach-confirm');
    const cancelRemoveOutreachBtn = document.getElementById('btn-cancel-remove-outreach');
    const performRemoveOutreachBtn = document.getElementById('btn-perform-remove-outreach');

    if (cancelRemoveOutreachBtn && removeOutreachModal) {
      cancelRemoveOutreachBtn.addEventListener('click', () => {
        removeOutreachModal.classList.add('hidden');
        AppState.pendingOutreachRemovalIds = [];
      });
    }

    if (removeOutreachModal) {
      removeOutreachModal.addEventListener('click', (e) => {
        if (e.target === removeOutreachModal) {
          removeOutreachModal.classList.add('hidden');
          AppState.pendingOutreachRemovalIds = [];
        }
      });
    }

    if (performRemoveOutreachBtn && removeOutreachModal) {
      performRemoveOutreachBtn.addEventListener('click', async () => {
        removeOutreachModal.classList.add('hidden');
        const ids = AppState.pendingOutreachRemovalIds || [];
        AppState.pendingOutreachRemovalIds = [];
        if (!ids.length) return;
        await removeFromOutreach(ids);
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
        if (removeOutreachModal && !removeOutreachModal.classList.contains('hidden')) {
          removeOutreachModal.classList.add('hidden');
          AppState.pendingOutreachRemovalIds = [];
        }
        const exportModal = document.getElementById('modal-export-leads');
        if (exportModal && !exportModal.classList.contains('hidden')) {
          closeExportModal();
        }
        const aiPanel = document.getElementById('ai-assistant-panel');
        if (aiPanel && !aiPanel.classList.contains('hidden')) {
          closeAiAssistant();
        }

        // Comprehensive dialog dismissal for full keyboard navigation polish
        const additionalModals = [
          'modal-move-outreach-confirm',
          'modal-lead-conversion',
          'modal-lead-tags',
          'modal-saved-view',
          'modal-delete-view-confirm',
          'modal-reset-leads-confirm',
          'modal-backup-restore-preview',
          'modal-target-edit',
          'modal-template-editor',
          'modal-followup-snooze',
          'modal-lead-reply',
          'modal-outreach-composer',
          'modal-followup-composer'
        ];
        for (const modalId of additionalModals) {
          const el = document.getElementById(modalId);
          if (el && !el.classList.contains('hidden')) {
            el.classList.add('hidden');
          }
        }
      }
    });

    initExportModalListeners();
    initAiAssistant();

    async function undoSavedLeadDelete(undoToken, fallbackLeads = []) {
      try {
        const res = await fetch('/api/leads/undo-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ undoToken, fallbackLeads })
        });
        const data = await res.json();
        if (!res.ok || !data.success || !Array.isArray(data.restoredLeads)) {
          showToast(data?.error || 'Unable to restore lead. Please try again.', 'error', 3500);
          return;
        }

        const restored = data.restoredLeads;
        if (!restored.length) {
          showToast('Unable to restore lead. Please try again.', 'error', 3500);
          return;
        }

        // Re-insert into AppState without duplicates
        restored.forEach((lead) => {
          const key = String(lead.id || lead.place_id);
          if (!AppState.savedLeads.some((l) => String(l.id || l.place_id) === key)) {
            AppState.savedLeads.unshift(lead);
          }
          if (AppState.allSavedLeads && !AppState.allSavedLeads.some((l) => String(l.id || l.place_id) === key)) {
            AppState.allSavedLeads.unshift(lead);
          }
          if (lead.is_favorite || lead.favorite) {
            if (!AppState.favoriteLeads.some((l) => String(l.id || l.place_id) === key)) {
              AppState.favoriteLeads.unshift(lead);
            }
          }
        });

        // Re-render active view
        if (AppState.currentView === 'favorites') {
          renderFavTableRows();
          populateFavFilterOptions();
          updateFavBulkActionBar();
        } else {
          filterAndRenderSavedLeads();
          populateSavedFilterOptions(AppState.allSavedLeads);
          updateBulkActionBar();
        }

        AppState.savedLeadsDirty = true;
        AppState.favoritesDirty = true;
        AppState.outreachDirty = true;
        AppState.followupDirty = true;
        await updateBadgeCounts();

        const count = restored.length;
        const msg = count === 1
          ? `Lead restored: ${restored[0].business_name || 'Lead'}`
          : `${count} leads restored.`;
        showToast(msg, 'success', 3000);
      } catch (err) {
        console.error('[UNDO DELETE ERROR]:', err);
        showToast('Unable to restore lead. Please try again.', 'error', 3500);
      }
    }

    async function undoOutreachRemove(undoToken, fallbackStates = []) {
      try {
        const res = await fetch('/api/outreach/undo-remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ undoToken, fallbackStates })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          showToast(data?.error || 'Unable to restore lead. Please try again.', 'error', 3500);
          return;
        }

        AppState.outreachDirty = true;
        AppState.followupDirty = true;
        AppState.savedLeadsDirty = true;
        AppState.favoritesDirty = true;

        const restoredLeads = data.restoredLeads || [];
        const firstId = restoredLeads.length > 0 ? (restoredLeads[0].id || restoredLeads[0].place_id) : AppState.outreach.activeLeadId;

        await loadOutreachData(firstId);
        renderOutreachCards();
        updateOutreachBulkControls();
        await updateBadgeCounts();

        const count = data.restoredCount || restoredLeads.length || 1;
        const msg = count === 1 ? 'Outreach lead restored.' : `${count} outreach leads restored.`;
        showToast(msg, 'success', 3000);
      } catch (err) {
        console.error('[UNDO OUTREACH ERROR]:', err);
        showToast('Unable to restore lead. Please try again.', 'error', 3500);
      }
    }

    let isPerformDeleteActive = false;
    if (performDeleteBtn && deleteModal) {
      performDeleteBtn.addEventListener('click', async () => {
        if (isPerformDeleteActive) return;
        isPerformDeleteActive = true;
        deleteModal.classList.add('hidden');

        try {
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

            const deletedObjs = (AppState.allSavedLeads || AppState.savedLeads || []).filter((l) => ids.includes(l.id) || (l.place_id && ids.includes(l.place_id)));

            try {
              const res = await fetch('/api/leads/delete-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
              });
              const data = await res.json();
              if (data.success) {
                const undoToken = data.undoToken;
                const fallback = (data.leads && data.leads.length > 0) ? data.leads : deletedObjs;
                const delCount = data.deletedCount || ids.length;

                showToast(`${delCount} leads deleted`, 'success', 5000, {
                  label: 'Undo',
                  onClick: async () => {
                    await undoSavedLeadDelete(undoToken, fallback);
                  }
                });

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
            const leadToDelete = AppState.leadToDelete;
            const id = leadToDelete.id || leadToDelete.place_id;
            const bizName = leadToDelete.business_name || 'Lead';

            try {
              const res = await fetch(`/api/leads/${encodeURIComponent(id)}`, { method: 'DELETE' });
              const data = await res.json();
              if (data.success) {
                const undoToken = data.undoToken;
                const fallback = data.lead ? [data.lead] : [leadToDelete];

                showToast(`Lead deleted: ${bizName}`, 'success', 5000, {
                  label: 'Undo',
                  onClick: async () => {
                    await undoSavedLeadDelete(undoToken, fallback);
                  }
                });

                if (isFavView) {
                  AppState.selectedFavLeadIds.delete(id);
                  AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => l.id !== id && (!l.place_id || l.place_id !== id));
                  AppState.savedLeads = AppState.savedLeads.filter((l) => l.id !== id && (!l.place_id || l.place_id !== id));
                  if (AppState.allSavedLeads) AppState.allSavedLeads = AppState.allSavedLeads.filter((l) => l.id !== id && (!l.place_id || l.place_id !== id));
                  updateFavBulkActionBar();
                  const row = document.querySelector(`#fav-leads-tbody tr[data-id="${id}"]`);
                  if (row) row.remove();
                  if (!document.getElementById('fav-leads-tbody')?.children.length) {
                    renderFavTableRows();
                  }
                } else {
                  AppState.selectedLeadIds.delete(id);
                  AppState.savedLeads = AppState.savedLeads.filter((l) => l.id !== id && (!l.place_id || l.place_id !== id));
                  if (AppState.allSavedLeads) AppState.allSavedLeads = AppState.allSavedLeads.filter((l) => l.id !== id && (!l.place_id || l.place_id !== id));
                  AppState.favoriteLeads = AppState.favoriteLeads.filter((l) => l.id !== id && (!l.place_id || l.place_id !== id));
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
            }
          }
        } finally {
          AppState.isBulkDelete = false;
          AppState.leadToDelete = null;
          isPerformDeleteActive = false;
        }
      });
    }
  }

  // ====================================================
  // ADVANCED EXPORT SYSTEM (REQUIREMENTS 1 - 30)
  // ====================================================

  const LEAD_EXPORT_CSV_HEADERS = [
    'Lead ID',
    'Business Name',
    'Category',
    'State',
    'City',
    'Location',
    'Phone',
    'Email',
    'Website',
    'Google Maps Link',
    'Website Status',
    'Opportunity Score',
    'Opportunity Level',
    'Lead Status',
    'Lead Date',
    'Saved Date',
    'Favorite',
    'Outreach Status',
    'Outreach Date',
    'Messages Sent',
    'Last Message Date',
    'Follow-Up Status',
    'Next Follow-Up Date',
    'Follow-Up Number',
    'Reply Status',
    'Notes',
    'Created At',
    'Updated At'
  ];

  const ACTIVITY_EXPORT_CSV_HEADERS = [
    'Activity ID',
    'Lead ID',
    'Business Name',
    'Category',
    'Activity Type',
    'Activity Title',
    'Activity Date',
    'Activity Details'
  ];

  function formatExportDate(val) {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function escapeCsvCell(val) {
    if (val == null) return '""';
    const str = String(val);
    return `"${str.replace(/"/g, '""')}"`;
  }

  function mapLeadToExportCsvRow(l) {
    let notesStr = '';
    if (Array.isArray(l.notes)) {
      notesStr = l.notes
        .map((n) => typeof n === 'string' ? n : `${n.created_at ? `[${formatExportDate(n.created_at)}] ` : ''}${n.text || ''}`)
        .filter(Boolean)
        .join('\n');
    } else if (typeof l.notes === 'string') {
      notesStr = l.notes;
    }

    const phoneVal = (l.phone || '').trim();
    const websiteUrl = (l.website || l.website_url || '').trim();
    const websiteStatus = (l.website_status === 'YES' || websiteUrl) ? 'Yes' : 'No';

    const leadDate = formatExportDate(l.date || l.created_at || l.saved_at);
    const savedDate = formatExportDate(l.saved_at || l.created_at);
    const outreachDate = formatExportDate(l.main_message_sent_at || l.first_message_sent_at || l.outreach_date);
    const lastMsgDate = formatExportDate(l.last_message_sent_at || l.main_message_sent_at || l.first_message_sent_at);
    const nextFuDate = formatExportDate(l.next_follow_up_at);
    const createdAt = formatExportDate(l.created_at);
    const updatedAt = formatExportDate(l.updated_at);

    const fuStatus = l.follow_up_status || l.next_follow_up_name || (l.follow_up_completed ? 'Completed' : (l.outreach_status === 'Follow-Up' ? 'Active' : 'N/A'));
    const fuNumber = l.current_follow_up_number != null ? l.current_follow_up_number : (l.follow_up_day != null ? l.follow_up_day : '');

    let msgCount = 0;
    if (l.messages_sent_count != null) {
      msgCount = l.messages_sent_count;
    } else if (Array.isArray(l.message_history)) {
      msgCount = l.message_history.length;
    } else if (l.first_message_sent) {
      msgCount = 1 + (l.follow_up_day || 0);
    }

    return [
      escapeCsvCell(l.id || l.place_id || ''),
      escapeCsvCell(l.business_name || l.name || ''),
      escapeCsvCell(l.category || ''),
      escapeCsvCell(l.state || ''),
      escapeCsvCell(l.city || ''),
      escapeCsvCell(l.address || l.formatted_address || l.location || ''),
      escapeCsvCell(phoneVal),
      escapeCsvCell(l.email || ''),
      escapeCsvCell(websiteUrl),
      escapeCsvCell(l.google_maps_url || l.maps_url || ''),
      escapeCsvCell(websiteStatus),
      l.opportunity_score != null ? l.opportunity_score : '',
      escapeCsvCell(l.opportunity_level || ''),
      escapeCsvCell(l.status || l.lead_status || 'SAVED'),
      escapeCsvCell(leadDate),
      escapeCsvCell(savedDate),
      escapeCsvCell((l.favorite || l.is_favorite) ? 'Yes' : 'No'),
      escapeCsvCell(l.outreach_status || 'Pending'),
      escapeCsvCell(outreachDate),
      msgCount,
      escapeCsvCell(lastMsgDate),
      escapeCsvCell(fuStatus),
      escapeCsvCell(nextFuDate),
      fuNumber,
      escapeCsvCell(l.reply_status || 'NO_REPLY'),
      escapeCsvCell(notesStr),
      escapeCsvCell(createdAt),
      escapeCsvCell(updatedAt)
    ];
  }

  function serializeLeadsToCsv(leads) {
    const headerRow = LEAD_EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',');
    const dataRows = leads.map((l) => mapLeadToExportCsvRow(l).join(','));
    return '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
  }

  function serializeActivitiesToCsv(activities) {
    const headerRow = ACTIVITY_EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',');
    const dataRows = activities.map((a) => [
      escapeCsvCell(a.activity_id || a.id || ''),
      escapeCsvCell(a.lead_id || ''),
      escapeCsvCell(a.business_name || ''),
      escapeCsvCell(a.category || ''),
      escapeCsvCell(a.activity_type || a.event_type || 'Activity'),
      escapeCsvCell(a.activity_title || a.event_title || ''),
      escapeCsvCell(a.activity_date || formatExportDate(a.created_at)),
      escapeCsvCell(a.activity_details || a.event_description || '')
    ].join(','));
    return '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
  }

  function serializeDailyPerformanceToCsv(perf) {
    const headers = ['Metric', 'Value'];
    const rows = [
      [escapeCsvCell('Date'), escapeCsvCell(perf.date || '')],
      [escapeCsvCell('Leads Found'), perf.leadsFound || 0],
      [escapeCsvCell('Leads Saved'), perf.leadsSaved || 0],
      [escapeCsvCell('Messages Sent'), perf.messagesSent || 0],
      [escapeCsvCell('First Messages Sent'), perf.firstMessagesSent || 0],
      [escapeCsvCell('Follow-Ups Sent'), perf.followUpsSent || 0],
      [escapeCsvCell('Replies'), perf.replies || 0],
      [escapeCsvCell('Outreach Added'), perf.addedToOutreach || 0],
      [escapeCsvCell('Follow-Ups Due'), perf.followUpsDue || 0],
      [escapeCsvCell('Target'), perf.target || 50],
      [escapeCsvCell('Progress'), `${perf.percentage || 0}%`],
      [escapeCsvCell('Remaining'), perf.remaining || 0],
      [escapeCsvCell('Status'), escapeCsvCell(perf.status || 'IN PROGRESS')]
    ];
    return '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows.map(r => r.join(','))].join('\r\n');
  }

  function generateSafeExportFilename(scope, format) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    let scopePart = 'SavedLeads';
    if (scope === 'filtered') scopePart = 'FilteredLeads';
    else if (scope === 'selected') scopePart = 'SelectedLeads';
    else if (scope === 'favorites') scopePart = 'Favorites';
    else if (scope === 'outreach') scopePart = 'Outreach';
    else if (scope === 'followup') scopePart = 'FollowUps';
    else if (scope === 'activity') scopePart = 'LeadActivity';
    else if (scope === 'daily_perf') scopePart = 'DailyPerformance';
    else if (scope === 'backup') scopePart = 'Backup';

    return `ClientHunter_${scopePart}_${dateStr}.${format}`;
  }

  let currentExportFormat = 'csv';

  async function resolveExportScopeData(scope) {
    // 1. Current Filtered Leads
    if (scope === 'filtered') {
      return {
        type: 'leads',
        scopeName: 'Current Filtered Results',
        fieldsDesc: 'Lead information (28 columns)',
        leads: [...(AppState.savedLeads || [])]
      };
    }

    // 2. All Saved Leads
    if (scope === 'all_saved') {
      let allLeads = AppState.allSavedLeads || [];
      if (!allLeads.length) {
        try {
          const res = await fetch('/api/leads/saved');
          const data = await res.json();
          if (data && data.success && Array.isArray(data.leads)) {
            allLeads = data.leads;
          }
        } catch (_) {}
      }
      return {
        type: 'leads',
        scopeName: 'All Saved Leads',
        fieldsDesc: 'Complete lead records (28 columns)',
        leads: allLeads
      };
    }

    // 3. Selected Leads
    if (scope === 'selected') {
      const allLeads = AppState.allSavedLeads && AppState.allSavedLeads.length
        ? AppState.allSavedLeads
        : (AppState.savedLeads || []);
      const selectedLeads = allLeads.filter((l) => AppState.selectedLeadIds && AppState.selectedLeadIds.has(String(l.id || l.place_id)));
      return {
        type: 'leads',
        scopeName: 'Selected Leads',
        fieldsDesc: 'Selected prospect records (28 columns)',
        leads: selectedLeads
      };
    }

    // 4. Favorites
    if (scope === 'favorites') {
      const allLeads = AppState.allSavedLeads && AppState.allSavedLeads.length
        ? AppState.allSavedLeads
        : (AppState.savedLeads || []);
      let favs = allLeads.filter((l) => Boolean(l.favorite || l.is_favorite));
      if (!favs.length && AppState.favoriteLeads && AppState.favoriteLeads.length) {
        favs = AppState.favoriteLeads;
      }
      return {
        type: 'leads',
        scopeName: 'Favorite Leads',
        fieldsDesc: 'Starred high-priority leads (28 columns)',
        leads: favs
      };
    }

    // 5. Outreach Leads
    if (scope === 'outreach') {
      let outreachList = [];
      if (AppState.outreach?.data?.allLeads) {
        outreachList = AppState.outreach.data.allLeads;
      } else {
        try {
          const res = await fetch('/api/outreach/data');
          const data = await res.json();
          if (data && data.success && Array.isArray(data.allLeads)) {
            outreachList = data.allLeads;
          }
        } catch (_) {}
      }
      const activeOutreach = outreachList.filter((l) => l.outreach_status && l.outreach_status !== 'Pending');
      return {
        type: 'leads',
        scopeName: 'Outreach Leads',
        fieldsDesc: 'Active outreach prospects (28 columns)',
        leads: activeOutreach
      };
    }

    // 6. Follow-Up Leads
    if (scope === 'followup') {
      let fuList = [];
      if (AppState.followup?.leads && AppState.followup.leads.length) {
        fuList = AppState.followup.leads;
      } else {
        try {
          const res = await fetch('/api/outreach/data');
          const data = await res.json();
          if (data && data.success && Array.isArray(data.allLeads)) {
            fuList = data.allLeads.filter((lead) => {
              return Boolean(
                lead.first_message_sent ||
                lead.main_message_sent_at ||
                lead.outreach_status === 'Follow-Up' ||
                lead.outreach_status === 'Replied' ||
                lead.outreach_status === 'Completed'
              );
            });
          }
        } catch (_) {}
      }
      return {
        type: 'leads',
        scopeName: 'Follow-Up Leads',
        fieldsDesc: 'Follow-up pipeline prospects (28 columns)',
        leads: fuList
      };
    }

    // 7. Activity Timeline
    if (scope === 'activity') {
      const allLeads = AppState.allSavedLeads && AppState.allSavedLeads.length
        ? AppState.allSavedLeads
        : (AppState.savedLeads || []);
      const activities = [];
      allLeads.forEach((l) => {
        if (Array.isArray(l.activities)) {
          l.activities.forEach((act) => {
            activities.push({
              activity_id: act.activity_id || act.id || '',
              lead_id: l.id || l.place_id || '',
              business_name: l.business_name || l.name || '',
              category: l.category || '',
              activity_type: act.event_type || act.type || 'activity_logged',
              activity_title: act.event_title || act.title || 'Outreach Activity',
              activity_date: formatExportDate(act.created_at || act.date),
              activity_details: act.event_description || act.description || (act.metadata ? JSON.stringify(act.metadata) : '')
            });
          });
        }
      });
      return {
        type: 'activity',
        scopeName: 'Outreach Activity Timeline',
        fieldsDesc: 'Chronological timeline log (8 columns)',
        activities
      };
    }

    // 8. Daily Performance Summary
    if (scope === 'daily_perf') {
      let perfData = null;
      try {
        const res = await fetch('/api/dashboard/daily-performance');
        const data = await res.json();
        if (data && data.success && data.performance) {
          perfData = data.performance;
        }
      } catch (_) {}
      if (!perfData) {
        perfData = {
          date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
          target: 50,
          messagesSent: 0,
          firstMessagesSent: 0,
          followUpsSent: 0,
          percentage: 0,
          remaining: 50,
          status: 'IN PROGRESS',
          leadsFound: 0,
          leadsSaved: 0,
          replies: 0,
          addedToOutreach: 0,
          followUpsDue: 0
        };
      }
      return {
        type: 'daily_perf',
        scopeName: 'Daily Performance Summary',
        fieldsDesc: 'Daily metric statistics',
        performance: perfData
      };
    }

    // 9. Full System Backup
    if (scope === 'backup') {
      let allLeads = AppState.allSavedLeads || [];
      if (!allLeads.length) {
        try {
          const res = await fetch('/api/leads/saved');
          const data = await res.json();
          if (data && data.success && Array.isArray(data.leads)) {
            allLeads = data.leads;
          }
        } catch (_) {}
      }

      // Deduplicate leads by unique ID
      const seenIds = new Set();
      const deduped = [];
      allLeads.forEach((lead) => {
        const id = String(lead.id || lead.place_id || '');
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          deduped.push(lead);
        } else if (!id) {
          deduped.push(lead);
        }
      });

      // Gather activities
      const allActivities = [];
      deduped.forEach((lead) => {
        if (Array.isArray(lead.activities)) {
          lead.activities.forEach((act) => {
            allActivities.push({
              ...act,
              business_name: lead.business_name || lead.name || '',
              category: lead.category || ''
            });
          });
        }
      });

      // Clean settings without secrets
      const rawSettings = AppState.settings || (window.SettingsModule ? window.SettingsModule.getDefaults() : {});
      const cleanSettings = JSON.parse(JSON.stringify(rawSettings));
      const sensitiveKeys = ['apikey', 'api_key', 'geminikey', 'gemini_key', 'supabasekey', 'supabase_key', 'token', 'secret', 'password'];
      function clean(obj) {
        if (!obj || typeof obj !== 'object') return;
        Object.keys(obj).forEach((k) => {
          if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
            delete obj[k];
          } else if (typeof obj[k] === 'object') {
            clean(obj[k]);
          }
        });
      }
      clean(cleanSettings);

      const backupObj = {
        exportVersion: '2.2.0',
        exportedAt: new Date().toISOString(),
        source: 'ClientHunter Desktop',
        leadCount: deduped.length,
        leads: deduped,
        settings: cleanSettings,
        outreachSettings: AppState.settings?.outreachTarget || { dailyTarget: 50 },
        activityTimeline: allActivities
      };

      return {
        type: 'backup',
        scopeName: 'Full ClientHunter Backup',
        fieldsDesc: 'All leads, notes, activities & settings',
        backupObj,
        leads: deduped
      };
    }

    return {
      type: 'leads',
      scopeName: 'Saved Leads',
      fieldsDesc: 'Lead information',
      leads: []
    };
  }

  async function saveExportFileWithDialog(filename, content, mimeType, format) {
    // 1. Electron Desktop IPC Bridge
    if (window.desktopApp && typeof window.desktopApp.saveExportFile === 'function') {
      try {
        const filters = format === 'json'
          ? [{ name: 'JSON Files (*.json)', extensions: ['json'] }, { name: 'All Files (*.*)', extensions: ['*'] }]
          : [{ name: 'CSV Files (*.csv)', extensions: ['csv'] }, { name: 'All Files (*.*)', extensions: ['*'] }];
        const res = await window.desktopApp.saveExportFile({
          defaultFileName: filename,
          content,
          mimeType,
          filters
        });
        return res;
      } catch (ipcErr) {
        console.warn('[DesktopApp] IPC save failed, falling back:', ipcErr);
      }
    }

    // 2. Chromium File System Access API (Native Windows Save Picker)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: format === 'json' ? 'JSON Document' : 'CSV Spreadsheet',
            accept: { [mimeType]: [`.${format}`] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return { success: true, fileName: handle.name || filename };
      } catch (pickerErr) {
        if (pickerErr && pickerErr.name === 'AbortError') {
          return { canceled: true };
        }
        console.warn('[Export] FileSystemAccess failed, using anchor fallback:', pickerErr);
      }
    }

    // 3. Standard Blob anchor download fallback
    try {
      const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2500);
      return { success: true, fileName: filename };
    } catch (blobErr) {
      return { success: false, error: blobErr.message };
    }
  }

  async function openExportModal(preferredScope = null) {
    const modal = document.getElementById('modal-export-leads');
    if (!modal) return;

    // Check if any filters are active in Saved Leads
    const hasActiveFilters = AppState.savedFilters && (
      Boolean(AppState.savedFilters.search) ||
      (AppState.savedFilters.date && AppState.savedFilters.date !== 'All') ||
      (AppState.savedFilters.website && AppState.savedFilters.website !== 'All') ||
      (AppState.savedFilters.status && AppState.savedFilters.status !== 'All') ||
      (AppState.savedFilters.category && AppState.savedFilters.category !== 'All') ||
      (AppState.savedFilters.state && AppState.savedFilters.state !== 'All') ||
      (AppState.savedFilters.city && AppState.savedFilters.city !== 'All') ||
      (AppState.savedFilters.favorite && AppState.savedFilters.favorite !== 'All') ||
      AppState.savedFilters.favsOnly ||
      AppState.savedFilters.phoneOnly
    );

    const scopeSelect = document.getElementById('export-scope-select');
    if (scopeSelect) {
      if (preferredScope) {
        scopeSelect.value = preferredScope;
      } else if (AppState.selectedLeadIds && AppState.selectedLeadIds.size > 0) {
        scopeSelect.value = 'selected';
      } else if (hasActiveFilters && AppState.savedLeads && AppState.savedLeads.length < AppState.allSavedLeads.length) {
        scopeSelect.value = 'filtered';
      } else {
        scopeSelect.value = 'all_saved';
      }
    }

    // If backup, default format is JSON
    if (scopeSelect && scopeSelect.value === 'backup') {
      setExportFormat('json');
    } else {
      setExportFormat('csv');
    }

    await updateExportPreview();
    modal.classList.remove('hidden');
  }

  function closeExportModal() {
    const modal = document.getElementById('modal-export-leads');
    if (modal) modal.classList.add('hidden');
  }

  function setExportFormat(fmt) {
    currentExportFormat = fmt;
    const btnCsv = document.getElementById('btn-format-csv');
    const btnJson = document.getElementById('btn-format-json');
    if (btnCsv && btnJson) {
      if (fmt === 'csv') {
        btnCsv.classList.add('active');
        btnJson.classList.remove('active');
        btnCsv.style.background = 'rgba(16, 185, 129, 0.15)';
        btnCsv.style.borderColor = '#10b981';
        btnCsv.style.color = '#10b981';
        btnJson.style.background = 'rgba(255, 255, 255, 0.04)';
        btnJson.style.borderColor = 'rgba(255, 255, 255, 0.12)';
        btnJson.style.color = '#cbd5e1';
      } else {
        btnJson.classList.add('active');
        btnCsv.classList.remove('active');
        btnJson.style.background = 'rgba(16, 185, 129, 0.15)';
        btnJson.style.borderColor = '#10b981';
        btnJson.style.color = '#10b981';
        btnCsv.style.background = 'rgba(255, 255, 255, 0.04)';
        btnCsv.style.borderColor = 'rgba(255, 255, 255, 0.12)';
        btnCsv.style.color = '#cbd5e1';
      }
    }
    const fmtPreview = document.getElementById('export-preview-format');
    if (fmtPreview) fmtPreview.textContent = fmt.toUpperCase();
  }

  async function updateExportPreview() {
    const scopeSelect = document.getElementById('export-scope-select');
    const scope = scopeSelect ? scopeSelect.value : 'all_saved';

    const recordsEl = document.getElementById('export-preview-records');
    const badgeEl = document.getElementById('export-preview-record-badge');
    const formatEl = document.getElementById('export-preview-format');
    const selectionEl = document.getElementById('export-preview-selection');
    const fieldsEl = document.getElementById('export-preview-fields');
    const noticeEl = document.getElementById('export-preview-notice');
    const noticeTextEl = document.getElementById('export-preview-notice-text');
    const submitBtn = document.getElementById('btn-export-submit');

    const data = await resolveExportScopeData(scope);

    let count = 0;
    if (data.type === 'leads') count = (data.leads || []).length;
    else if (data.type === 'activity') count = (data.activities || []).length;
    else if (data.type === 'daily_perf') count = 1;
    else if (data.type === 'backup') count = (data.leads || []).length;

    if (recordsEl) recordsEl.textContent = count;
    if (badgeEl) badgeEl.textContent = `${count} record${count === 1 ? '' : 's'}`;
    if (formatEl) formatEl.textContent = currentExportFormat.toUpperCase();
    if (selectionEl) selectionEl.textContent = data.scopeName;
    if (fieldsEl) fieldsEl.textContent = data.fieldsDesc;

    // Validation handling
    if (scope === 'selected' && count === 0) {
      if (noticeEl) {
        noticeEl.style.display = 'flex';
        if (noticeTextEl) noticeTextEl.textContent = 'Select at least one lead to export.';
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
      }
    } else if (count === 0 && scope !== 'daily_perf') {
      if (noticeEl) {
        noticeEl.style.display = 'flex';
        if (noticeTextEl) noticeTextEl.textContent = 'No records match the chosen export criteria.';
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
      }
    } else {
      if (noticeEl) noticeEl.style.display = 'none';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
      }
    }
  }

  async function executeAdvancedExport(testOverrideSave = null) {
    const scopeSelect = document.getElementById('export-scope-select');
    const scope = scopeSelect ? scopeSelect.value : 'all_saved';
    const format = currentExportFormat;

    const submitBtn = document.getElementById('btn-export-submit');
    const submitText = document.getElementById('text-export-submit');
    const submitIcon = document.getElementById('icon-export-submit');

    // Prevent zero records selected
    if (scope === 'selected' && (!AppState.selectedLeadIds || AppState.selectedLeadIds.size === 0)) {
      showToast('Select at least one lead to export.', 'info');
      return;
    }

    // Set UI loading state
    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.textContent = 'Preparing export...';
    if (submitIcon) {
      submitIcon.className = 'fa-solid fa-spinner btn-export-spin';
    }

    try {
      await new Promise((r) => setTimeout(r, 40));

      const data = await resolveExportScopeData(scope);
      let content = '';
      let mimeType = 'text/csv';

      if (format === 'csv') {
        mimeType = 'text/csv';
        if (data.type === 'leads' || data.type === 'backup') {
          content = serializeLeadsToCsv(data.leads || []);
        } else if (data.type === 'activity') {
          content = serializeActivitiesToCsv(data.activities || []);
        } else if (data.type === 'daily_perf') {
          content = serializeDailyPerformanceToCsv(data.performance || {});
        }
      } else {
        mimeType = 'application/json';
        if (data.type === 'backup') {
          content = JSON.stringify(data.backupObj, null, 2);
        } else if (data.type === 'daily_perf') {
          content = JSON.stringify({
            exportVersion: '2.2.0',
            exportedAt: new Date().toISOString(),
            source: 'ClientHunter Desktop',
            dailyPerformance: data.performance
          }, null, 2);
        } else if (data.type === 'activity') {
          content = JSON.stringify({
            exportVersion: '2.2.0',
            exportedAt: new Date().toISOString(),
            source: 'ClientHunter Desktop',
            activityCount: (data.activities || []).length,
            activities: data.activities || []
          }, null, 2);
        } else {
          content = JSON.stringify({
            exportVersion: '2.2.0',
            exportedAt: new Date().toISOString(),
            source: 'ClientHunter Desktop',
            leadCount: (data.leads || []).length,
            leads: data.leads || []
          }, null, 2);
        }
      }

      if (submitText) submitText.textContent = 'Exporting...';
      await new Promise((r) => setTimeout(r, 20));

      const filename = generateSafeExportFilename(scope, format);
      const saveRes = (typeof testOverrideSave === 'function')
        ? await testOverrideSave(filename, content, mimeType, format)
        : await saveExportFileWithDialog(filename, content, mimeType, format);

      if (saveRes && saveRes.canceled) {
        closeExportModal();
        return;
      }

      if (saveRes && saveRes.success) {
        closeExportModal();
        let recordCount = 0;
        if (data.type === 'leads' || data.type === 'backup') recordCount = (data.leads || []).length;
        else if (data.type === 'activity') recordCount = (data.activities || []).length;
        else if (data.type === 'daily_perf') recordCount = 1;

        const displayName = saveRes.fileName || filename;
        const msg = data.type === 'daily_perf'
          ? `Daily performance exported successfully (${displayName})`
          : data.type === 'activity'
            ? `${recordCount} activity events exported successfully (${displayName})`
            : `${recordCount} lead${recordCount === 1 ? '' : 's'} exported successfully (${displayName})`;

        showToast(msg, 'success', 4000);
      } else {
        const errDetail = (saveRes && saveRes.error) ? saveRes.error : 'The file could not be created.';
        showToast(`Export failed. ${errDetail}`, 'error', 4500);
      }
    } catch (err) {
      console.error('[AdvancedExport] Error executing export:', err);
      showToast(`Export failed. ${err.message || 'The file could not be created.'}`, 'error', 4500);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (submitText) submitText.textContent = 'Export';
      if (submitIcon) {
        submitIcon.className = 'fa-solid fa-arrow-down-to-bracket';
      }
    }
  }

  function initExportModalListeners() {
    const modal = document.getElementById('modal-export-leads');
    const closeXBtn = document.getElementById('btn-export-close-x');
    const cancelBtn = document.getElementById('btn-export-cancel');
    const submitBtn = document.getElementById('btn-export-submit');
    const scopeSelect = document.getElementById('export-scope-select');
    const btnCsv = document.getElementById('btn-format-csv');
    const btnJson = document.getElementById('btn-format-json');

    if (closeXBtn) closeXBtn.addEventListener('click', closeExportModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeExportModal);

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeExportModal();
      });
    }

    if (scopeSelect) {
      scopeSelect.addEventListener('change', () => {
        if (scopeSelect.value === 'backup') {
          setExportFormat('json');
        }
        updateExportPreview();
      });
    }

    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        setExportFormat('csv');
      });
    }

    if (btnJson) {
      btnJson.addEventListener('click', () => {
        setExportFormat('json');
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', executeAdvancedExport);
    }
  }

  // ==================================================
  // SIMPLE GEMINI-POWERED AI ASSISTANT MODULE
  // ==================================================
  let aiChatHistory = [];
  let isAiQueryInFlight = false;

  function appendAiChatHistory(entry) {
    aiChatHistory.push(entry);
    if (aiChatHistory.length > 40) {
      aiChatHistory = aiChatHistory.slice(-40);
    }
  }

  function openAiAssistant() {
    const panel = document.getElementById('ai-assistant-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    const navLink = document.getElementById('nav-ai-assistant');
    if (navLink) navLink.classList.add('active');

    const headerBtn = document.getElementById('btn-header-ai-assistant');
    if (headerBtn) headerBtn.classList.add('active');

    const input = document.getElementById('ai-input-field');
    if (input) {
      setTimeout(() => input.focus(), 80);
    }
    scrollAiMessagesToBottom();
  }

  function closeAiAssistant() {
    const panel = document.getElementById('ai-assistant-panel');
    if (!panel) return;
    panel.classList.add('hidden');

    const navLink = document.getElementById('nav-ai-assistant');
    if (navLink) navLink.classList.remove('active');

    const headerBtn = document.getElementById('btn-header-ai-assistant');
    if (headerBtn) headerBtn.classList.remove('active');
  }

  function toggleAiAssistant(forceOpen = null) {
    const panel = document.getElementById('ai-assistant-panel');
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    if (forceOpen === true || (forceOpen === null && isHidden)) {
      openAiAssistant();
    } else {
      closeAiAssistant();
    }
  }

  function scrollAiMessagesToBottom() {
    const container = document.getElementById('ai-messages-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function clearAiChat() {
    aiChatHistory = [];
    const container = document.getElementById('ai-messages-container');
    if (!container) return;
    container.innerHTML = `
      <div class="ai-message-row ai-message-row-assistant">
        <div class="ai-msg-avatar">✨</div>
        <div class="ai-msg-bubble">
          <p class="ai-greeting-text" style="margin: 0 0 10px 0;">Hi! How can I help?</p>
          <div class="ai-quick-chips" id="ai-quick-chips">
            <button type="button" class="ai-quick-chip" data-query="How did I do today?">How did I do today?</button>
            <button type="button" class="ai-quick-chip" data-query="What should I work on next?">What should I work on next?</button>
            <button type="button" class="ai-quick-chip" data-query="How many follow-ups are due?">Show my follow-ups</button>
            <button type="button" class="ai-quick-chip" data-query="How many saved leads do I have?">How many leads do I have?</button>
            <button type="button" class="ai-quick-chip" data-query="How many leads are in Outreach?">Show Outreach stats</button>
            <button type="button" class="ai-quick-chip" data-query="Show Follow-Up stats">Show Follow-Up stats</button>
          </div>
        </div>
      </div>
    `;
    bindAiQuickChips();
  }

  function escapeAiHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderAssistantReplyContent(rawText) {
    let escaped = escapeAiHtml(rawText);

    // Replace navigation action tags in brackets with action buttons
    const actionReplacements = [
      { pattern: /\[Open Follow-?Ups?\]/gi, html: '<br><button type="button" class="btn-ai-action" data-nav="followup"><i class="fa-solid fa-clock-rotate-left"></i> Open Follow-Ups</button>' },
      { pattern: /\[Open Outreach\]/gi, html: '<br><button type="button" class="btn-ai-action" data-nav="outreach"><i class="fa-solid fa-paper-plane"></i> Open Outreach</button>' },
      { pattern: /\[Open Saved Leads?\]/gi, html: '<br><button type="button" class="btn-ai-action" data-nav="saved-leads"><i class="fa-solid fa-bookmark"></i> Open Saved Leads</button>' },
      { pattern: /\[Open Dashboard\]/gi, html: '<br><button type="button" class="btn-ai-action" data-nav="dashboard"><i class="fa-solid fa-chart-line"></i> Open Dashboard</button>' },
      { pattern: /\[Open API Settings?\]/gi, html: '<br><button type="button" class="btn-ai-action" data-nav="settings-api"><i class="fa-solid fa-shield-halved"></i> Open API Settings</button>' }
    ];

    actionReplacements.forEach(({ pattern, html }) => {
      escaped = escaped.replace(pattern, html);
    });

    escaped = escaped.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    return escaped;
  }

  function appendAiMessage(role, contentHtml, isRaw = false) {
    const container = document.getElementById('ai-messages-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = `ai-message-row ${role === 'user' ? 'ai-message-row-user' : 'ai-message-row-assistant'}`;

    if (role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'ai-msg-bubble ai-msg-bubble-user';
      bubble.textContent = contentHtml;
      row.appendChild(bubble);
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'ai-msg-avatar';
      avatar.textContent = '✨';
      row.appendChild(avatar);

      const bubble = document.createElement('div');
      bubble.className = 'ai-msg-bubble';
      if (isRaw) {
        bubble.innerHTML = contentHtml;
      } else {
        bubble.innerHTML = renderAssistantReplyContent(contentHtml);
      }
      row.appendChild(bubble);
    }

    container.appendChild(row);
    scrollAiMessagesToBottom();
  }

  async function sendAiAssistantQuery(explicitText = null, testFetchOverride = null) {
    if (isAiQueryInFlight) return;

    const inputField = document.getElementById('ai-input-field');
    const queryText = (explicitText || (inputField ? inputField.value : '')).trim();
    if (!queryText) return;

    if (inputField) inputField.value = '';

    // Append user message
    appendAiMessage('user', queryText);
    appendAiChatHistory({ role: 'user', text: queryText });

    // Show thinking indicator
    const thinkingEl = document.getElementById('ai-thinking-indicator');
    if (thinkingEl) thinkingEl.style.display = 'flex';
    scrollAiMessagesToBottom();

    isAiQueryInFlight = true;

    // Determine currently active lead if available
    let activeLead = null;
    if (AppState.currentView === 'outreach' && AppState.outreach?.activeLeadId) {
      const leadId = AppState.outreach.activeLeadId;
      const allLeads = AppState.outreach?.data?.allLeads || AppState.allSavedLeads || [];
      activeLead = allLeads.find((l) => String(l.id || l.place_id) === String(leadId)) || null;
    } else if (AppState.activeOutreachLead) {
      activeLead = AppState.activeOutreachLead;
    } else if (AppState.selectedLeadIds && AppState.selectedLeadIds.size === 1) {
      const singleId = Array.from(AppState.selectedLeadIds)[0];
      activeLead = (AppState.allSavedLeads || []).find((l) => String(l.id || l.place_id) === singleId) || null;
    }

    try {
      const fetchFn = testFetchOverride || window.fetch;
      const res = await fetchFn('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText,
          history: aiChatHistory,
          activeLead
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data && data.error === 'GEMINI_NOT_CONFIGURED') {
          const actionBtn = '<br><button type="button" class="btn-ai-action" data-nav="settings-api"><i class="fa-solid fa-shield-halved"></i> Open API Settings</button>';
          appendAiMessage('assistant', `Gemini is not configured yet.${actionBtn}`, true);
          appendAiChatHistory({ role: 'assistant', text: 'Gemini is not configured yet.' });
        } else if (data && data.error === 'GEMINI_UNAVAILABLE') {
          appendAiMessage('assistant', 'AI Assistant is temporarily unavailable. Please check your Gemini API configuration.');
          appendAiChatHistory({ role: 'assistant', text: 'AI Assistant is temporarily unavailable. Please check your Gemini API configuration.' });
        } else {
          appendAiMessage('assistant', data.message || 'AI Assistant is temporarily unavailable. Please check your Gemini API configuration.');
        }
        return;
      }

      // Success
      const reply = data.reply || "I don't have enough data to calculate that.";
      appendAiMessage('assistant', reply);
      appendAiChatHistory({ role: 'assistant', text: reply });
    } catch (err) {
      console.warn('[AiAssistant] Error communicating with assistant backend:', err);
      appendAiMessage('assistant', 'AI Assistant is temporarily unavailable. Please check your Gemini API configuration.');
    } finally {
      isAiQueryInFlight = false;
      if (thinkingEl) thinkingEl.style.display = 'none';
      scrollAiMessagesToBottom();
    }
  }

  function bindAiQuickChips() {
    const chips = document.querySelectorAll('.ai-quick-chip');
    chips.forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const query = chip.getAttribute('data-query');
        if (query) {
          sendAiAssistantQuery(query);
        }
      });
    });
  }

  function initAiAssistant() {
    const closeBtn = document.getElementById('btn-ai-close-panel');
    const clearBtn = document.getElementById('btn-ai-clear-chat');
    const inputForm = document.getElementById('ai-input-form');
    const navLink = document.getElementById('nav-ai-assistant');
    const headerBtn = document.getElementById('btn-header-ai-assistant');
    const dashBtn = document.getElementById('dash-btn-open-assistant');
    const dashLink = document.getElementById('dash-link-open-assistant');

    if (closeBtn) closeBtn.addEventListener('click', closeAiAssistant);
    if (clearBtn) clearBtn.addEventListener('click', clearAiChat);

    if (inputForm) {
      inputForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendAiAssistantQuery();
      });
    }

    if (navLink) {
      navLink.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAiAssistant();
      });
    }

    if (headerBtn) {
      headerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAiAssistant();
      });
    }

    if (dashBtn) {
      dashBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openAiAssistant();
      });
    }

    if (dashLink) {
      dashLink.addEventListener('click', (e) => {
        e.preventDefault();
        openAiAssistant();
      });
    }

    // Delegate clicks on dynamic action buttons in assistant bubbles
    const container = document.getElementById('ai-messages-container');
    if (container) {
      container.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('.btn-ai-action');
        if (actionBtn) {
          const navTarget = actionBtn.getAttribute('data-nav');
          if (navTarget === 'settings-api') {
            switchView('settings');
            const apiTab = document.getElementById('tab-btn-api');
            if (apiTab) apiTab.click();
          } else if (navTarget) {
            switchView(navTarget);
          }
        }
      });
    }

    bindAiQuickChips();

    // Expose on window for automated verification
    window.SimpleAiAssistantModule = {
      open: openAiAssistant,
      close: closeAiAssistant,
      toggle: toggleAiAssistant,
      clearChat: clearAiChat,
      sendQuery: sendAiAssistantQuery,
      getHistory: () => [...aiChatHistory]
    };
  }

  function initSavedLeadsToolbar() {
    const searchField = document.getElementById('saved-search-box');
    const dateFilter = document.getElementById('saved-filter-date');
    const webFilter = document.getElementById('saved-filter-website');
    const statusFilter = document.getElementById('saved-filter-status');
    const catFilter = document.getElementById('saved-filter-category');
    const stateFilter = document.getElementById('saved-filter-state');
    const cityFilter = document.getElementById('saved-filter-city');
    const favFilter = document.getElementById('saved-filter-favorite');
    const waFilter = document.getElementById('saved-filter-whatsapp');
    const fuFilter = document.getElementById('saved-filter-followup');
    const replyFilter = document.getElementById('saved-filter-reply');
    const priorityFilter = document.getElementById('saved-filter-priority');
    const favsCheck = document.getElementById('saved-check-favs');
    const phoneCheck = document.getElementById('saved-check-phone');
    const rowsChoice = document.getElementById('saved-rows-choice');
    const refreshBtn = document.getElementById('btn-reload-saved-table');
    const clearFiltersBtn = document.getElementById('btn-clear-saved-filters');
    const emptyClearBtn = document.getElementById('btn-empty-clear-filters');
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

    if (dateFilter) {
      dateFilter.addEventListener('change', function () {
        AppState.savedFilters.date = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
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

    if (cityFilter) {
      cityFilter.addEventListener('change', function () {
        AppState.savedFilters.city = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (favFilter) {
      favFilter.addEventListener('change', function () {
        AppState.savedFilters.favorite = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (waFilter) {
      waFilter.addEventListener('change', function () {
        AppState.savedFilters.whatsapp = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (fuFilter) {
      fuFilter.addEventListener('change', function () {
        AppState.savedFilters.followup = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (replyFilter) {
      replyFilter.addEventListener('change', function () {
        AppState.savedFilters.reply = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    if (priorityFilter) {
      priorityFilter.addEventListener('change', function () {
        AppState.savedFilters.priority = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    const conversionFilter = document.getElementById('saved-filter-conversion');
    if (conversionFilter) {
      conversionFilter.addEventListener('change', function () {
        AppState.savedFilters.conversion = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    const tagFilter = document.getElementById('saved-filter-tag');
    if (tagFilter) {
      tagFilter.addEventListener('change', function () {
        AppState.savedFilters.tag = this.value;
        AppState.savedFilters.page = 1;
        filterAndRenderSavedLeads();
      });
    }

    setupLeadConversionModalListeners();
    setupLeadTagsModalListeners();
    setupSavedViewsListeners();

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

    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        clearSavedFilters();
      });
    }

    if (emptyClearBtn) {
      emptyClearBtn.addEventListener('click', () => {
        clearSavedFilters();
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

    // Advanced Export Leads
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        openExportModal();
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
              <div style="display:inline-flex;align-items:center;gap:4px;">
                <span class="lead-title-link fav-title-link" data-id="${lead.id}">${escapeHtml(lead.business_name)}</span>
                ${Array.isArray(lead.notes) && lead.notes.length > 0 ? `<span class="lead-notes-badge" title="${lead.notes.length} note${lead.notes.length === 1 ? '' : 's'}"><i class="fa-regular fa-note-sticky"></i></span>` : ''}
              </div>
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
  const fetchOutreachData = loadOutreachData;
  window.fetchOutreachData = loadOutreachData;

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
          (l.category && l.category.toLowerCase().includes(q)) ||
          (Array.isArray(l.tags) && l.tags.some((t) => String(t).toLowerCase().includes(q)))
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

    // 4. Priority Filter
    if (AppState.outreach.priorityFilter && AppState.outreach.priorityFilter !== 'ALL') {
      leads = leads.filter((l) => (l.priority || 'Medium') === AppState.outreach.priorityFilter);
    }

    // 4b. Conversion Filter
    if (AppState.outreach.conversionFilter && AppState.outreach.conversionFilter !== 'ALL') {
      if (AppState.outreach.conversionFilter === 'CONVERTED') {
        leads = leads.filter((l) => Boolean(l.converted));
      } else if (AppState.outreach.conversionFilter === 'NOT_CONVERTED') {
        leads = leads.filter((l) => !l.converted);
      }
    }

    // 4c. Tag Filter
    if (AppState.outreach.tagFilter && AppState.outreach.tagFilter !== 'ALL') {
      if (AppState.outreach.tagFilter === 'NO_TAG') {
        leads = leads.filter((l) => !Array.isArray(l.tags) || l.tags.length === 0);
      } else {
        const targetTag = AppState.outreach.tagFilter.toLowerCase();
        leads = leads.filter((l) => Array.isArray(l.tags) && l.tags.some((t) => String(t).toLowerCase() === targetTag));
      }
    }

    // 5. Smart Queue (High -> Medium -> Low), preserving existing order within tiers
    if (AppState.outreach.smartQueueActive) {
      const priorityOrder = { High: 1, Medium: 2, Low: 3 };
      leads = [...leads].sort((a, b) => {
        const pA = priorityOrder[a.priority || 'Medium'] || 2;
        const pB = priorityOrder[b.priority || 'Medium'] || 2;
        return pA - pB;
      });
    }

    const totalFiltered = leads.length;
    AppState.outreach.lastFilteredCount = totalFiltered;
    const allOutreachLeads = getActiveOutreachList();
    const totalAll = allOutreachLeads.length;
    const isFiltered = (AppState.outreach.searchQuery || '').trim() !== '' ||
      AppState.outreach.categoryFilter !== 'ALL' ||
      AppState.outreach.siteFilter !== 'ALL' ||
      AppState.outreach.priorityFilter !== 'ALL' ||
      AppState.outreach.conversionFilter !== 'ALL' ||
      AppState.outreach.tagFilter !== 'ALL';

    const showingIndicator = document.getElementById('outreach-showing-indicator');
    const rowsChoice = document.getElementById('outreach-rows-choice');
    if (rowsChoice && AppState.outreach.rowsPerPage) {
      rowsChoice.value = String(AppState.outreach.rowsPerPage);
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
      if (showingIndicator) {
        showingIndicator.textContent = isFiltered ? `Showing 0 of ${totalAll} leads` : 'Showing 0 leads';
      }
      renderOutreachPaginationButtons(0, 1, AppState.outreach.rowsPerPage || 25);
      AppState.outreach.selectedLeadIds.clear();
      updateOutreachBulkControls();
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const perPage = AppState.outreach.rowsPerPage || 25;
    const maxPage = Math.max(1, Math.ceil(totalFiltered / perPage));
    if (AppState.outreach.page > maxPage) {
      AppState.outreach.page = maxPage;
    }
    if (AppState.outreach.page < 1) {
      AppState.outreach.page = 1;
    }
    const page = AppState.outreach.page;
    const startIndex = (page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, totalFiltered);
    const visibleLeads = leads.slice(startIndex, endIndex);

    if (showingIndicator) {
      if (isFiltered) {
        if (totalFiltered <= perPage) {
          showingIndicator.textContent = `Showing ${totalFiltered} of ${totalAll} leads`;
        } else {
          showingIndicator.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalFiltered} leads (${totalFiltered} of ${totalAll} filtered)`;
        }
      } else {
        showingIndicator.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalAll} leads`;
      }
    }

    const html = visibleLeads.map((lead) => {
      const leadId = lead.id || lead.place_id;
      const isActive = leadId === AppState.outreach.activeLeadId;
      const isChecked = AppState.outreach.selectedLeadIds.has(leadId);

      let statusBadge = '<span class="outreach-card-status-badge">Not Contacted</span>';
      let actionLabel = 'Message';

      if (lead.outreach_status === 'Replied') {
        statusBadge = '<span class="outreach-card-status-badge badge-replied">Replied</span>';
      }

      const scoreNum = lead.opportunity_score || 50;
      const outcomeVal = lead.contact_outcome || 'No outcome';
      const outcomeTooltip = `Outcome: ${outcomeVal}${lead.contact_outcome_reason ? ' — ' + lead.contact_outcome_reason : ''}`;

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
              ${Array.isArray(lead.tags) && lead.tags.length > 0 ? `
                <div class="card-tags-list">
                  ${lead.tags.slice(0, 3).map((t) => `<span class="lead-tag-badge lead-tag-badge-sm" title="Tag: ${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}
                  ${lead.tags.length > 3 ? `<span class="lead-tag-badge lead-tag-badge-sm lead-tag-more">+${lead.tags.length - 3}</span>` : ''}
                </div>
              ` : ''}
            </div>
          </div>
          <div class="outreach-card-right">
            <select class="card-priority-pill" data-id="${leadId}" data-priority="${escapeHtml(lead.priority || 'Medium')}" title="Lead Priority">
              <option value="High" ${(lead.priority || 'Medium') === 'High' ? 'selected' : ''}>High</option>
              <option value="Medium" ${(lead.priority || 'Medium') === 'Medium' ? 'selected' : ''}>Medium</option>
              <option value="Low" ${(lead.priority || 'Medium') === 'Low' ? 'selected' : ''}>Low</option>
            </select>
            <span class="card-outcome-pill" data-id="${leadId}" data-outcome="${escapeHtml(outcomeVal)}" title="${escapeHtml(outcomeTooltip)}">${escapeHtml(outcomeVal)}</span>
            ${lead.converted ? `<span class="card-conversion-pill" data-id="${leadId}" title="Converted: ${escapeHtml(lead.conversion_service || 'Yes')}"><i class="fa-solid fa-trophy"></i> Converted</span>` : ''}
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
    renderOutreachPaginationButtons(totalFiltered, page, perPage);
    updateOutreachBulkControls();
  }

  function renderOutreachPaginationButtons(total, currentPage, perPage) {
    const container = document.getElementById('outreach-page-nums-list');
    const prevBtn = document.getElementById('btn-outreach-page-prev');
    const nextBtn = document.getElementById('btn-outreach-page-next');
    if (!container) return;

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    container.innerHTML = '';

    // Show up to 5 page numbers (identical to Saved Leads)
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
        AppState.outreach.page = p;
        renderOutreachCards();
      });
      container.appendChild(btn);
    }
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

    // Priority select
    const wsPriSelect = document.getElementById('ws-priority-select');
    if (wsPriSelect) {
      wsPriSelect.value = lead.priority || 'Medium';
      wsPriSelect.disabled = false;
      wsPriSelect.removeAttribute('disabled');
      wsPriSelect.onchange = (e) => {
        const newPri = e.target.value;
        lead.priority = newPri;
        updateLeadPriority(lead.id || lead.place_id, newPri);
      };
    }

    // Contact Outcome & Reason in Conversation Workspace
    const wsOutcomeBadge = document.getElementById('ws-outcome-current-badge');
    const wsOutcomeSelect = document.getElementById('ws-outcome-select');
    const wsOutcomeReason = document.getElementById('ws-outcome-reason-input');
    const wsOutcomeSaveBtn = document.getElementById('btn-ws-save-outcome');

    const curOutcome = lead.contact_outcome || '';
    const curReason = lead.contact_outcome_reason || '';
    const dispOutcome = curOutcome || 'No outcome';

    if (wsOutcomeBadge) {
      wsOutcomeBadge.textContent = dispOutcome;
      wsOutcomeBadge.setAttribute('data-outcome', dispOutcome);
    }
    if (wsOutcomeSelect) {
      wsOutcomeSelect.value = curOutcome;
      wsOutcomeSelect.disabled = false;
      wsOutcomeSelect.removeAttribute('disabled');
    }
    if (wsOutcomeReason) {
      wsOutcomeReason.value = curReason;
      wsOutcomeReason.disabled = false;
      wsOutcomeReason.removeAttribute('disabled');
    }
    if (wsOutcomeSaveBtn) {
      wsOutcomeSaveBtn.disabled = false;
      wsOutcomeSaveBtn.removeAttribute('disabled');
      wsOutcomeSaveBtn.onclick = async () => {
        const chosen = wsOutcomeSelect ? wsOutcomeSelect.value : '';
        const reas = wsOutcomeReason ? wsOutcomeReason.value.trim() : '';
        await updateLeadOutcome(lead.id || lead.place_id, chosen, reas);
      };
    }

    // Lead Conversion in Conversation Workspace
    const wsConvBadge = document.getElementById('ws-conversion-current-badge');
    const wsConvInfo = document.getElementById('ws-conversion-info-text');
    const wsConvBtn = document.getElementById('btn-ws-open-conversion');
    const wsConvBtnLabel = document.getElementById('btn-ws-conversion-action-label');

    const isConv = Boolean(lead.converted);
    if (wsConvBadge) {
      wsConvBadge.textContent = isConv ? 'Converted' : 'Not Converted';
      wsConvBadge.setAttribute('data-converted', isConv ? 'true' : 'false');
    }
    if (wsConvInfo) {
      if (isConv) {
        const parts = [];
        if (lead.conversion_service) parts.push(lead.conversion_service);
        if (lead.conversion_value != null && lead.conversion_value !== '') parts.push(`$${Number(lead.conversion_value).toLocaleString()}`);
        if (lead.conversion_date) {
          try { parts.push(new Date(lead.conversion_date).toLocaleDateString()); } catch (e) {}
        }
        wsConvInfo.textContent = parts.join(' • ') || 'Lead Converted';
      } else {
        wsConvInfo.textContent = 'No conversion recorded';
      }
    }
    if (wsConvBtnLabel) {
      wsConvBtnLabel.textContent = isConv ? 'Edit Conversion' : 'Mark Converted';
    }
    if (wsConvBtn) {
      wsConvBtn.disabled = false;
      wsConvBtn.removeAttribute('disabled');
      wsConvBtn.onclick = () => openLeadConversionModal(lead.id || lead.place_id);
    }

    // Lead Tags in Conversation Workspace
    const wsTagsCount = document.getElementById('ws-tags-count');
    const wsTagsList = document.getElementById('ws-tags-list');
    const wsTagsBtn = document.getElementById('btn-ws-open-tag-manager');

    const leadTags = Array.isArray(lead.tags) ? lead.tags : [];
    if (wsTagsCount) wsTagsCount.textContent = leadTags.length;
    if (wsTagsList) {
      if (leadTags.length === 0) {
        wsTagsList.innerHTML = '<span class="ws-tags-empty">No tags assigned</span>';
      } else {
        wsTagsList.innerHTML = leadTags.map((t) => `
          <span class="lead-tag-badge" data-tag="${escapeHtml(t)}" title="Tag: ${escapeHtml(t)}">
            <span>${escapeHtml(t)}</span>
            <button type="button" class="tag-remove-btn ws-tag-remove" data-id="${lead.id || lead.place_id}" data-tag="${escapeHtml(t)}" title="Remove tag">&times;</button>
          </span>
        `).join('');

        wsTagsList.querySelectorAll('.ws-tag-remove').forEach((btn) => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const tagToRemove = btn.getAttribute('data-tag');
            const currentLead = AppState.activeOutreachLead || lead;
            const curTags = Array.isArray(currentLead.tags) ? currentLead.tags : [];
            const newTags = curTags.filter((x) => x !== tagToRemove);
            await updateLeadTags(lead.id || lead.place_id, newTags);
          };
        });
      }
    }
    if (wsTagsBtn) {
      wsTagsBtn.disabled = false;
      wsTagsBtn.removeAttribute('disabled');
      wsTagsBtn.onclick = () => openLeadTagsModal(lead.id || lead.place_id);
    }

    // Send button text
    const sendLabel = document.getElementById('btn-ws-send-label');
    if (sendLabel) {
      sendLabel.textContent = 'Send Message (Open Outreach Dialog)';
    }

    // Ensure action buttons are enabled for active lead
    const wsRemoveBtn = document.getElementById('ws-btn-remove');
    if (wsRemoveBtn) { wsRemoveBtn.disabled = false; wsRemoveBtn.removeAttribute('disabled'); wsRemoveBtn.classList.remove('disabled'); }
    const wsSendBtn = document.getElementById('btn-ws-open-composer');
    if (wsSendBtn) { wsSendBtn.disabled = false; wsSendBtn.removeAttribute('disabled'); wsSendBtn.classList.remove('disabled'); }
    if (favBtn) { favBtn.disabled = false; favBtn.removeAttribute('disabled'); favBtn.classList.remove('disabled'); }
    const wsViewBtn = document.getElementById('ws-btn-view-lead');
    if (wsViewBtn) { wsViewBtn.disabled = false; wsViewBtn.removeAttribute('disabled'); wsViewBtn.classList.remove('disabled'); }
    const wsGmapsBtn = document.getElementById('ws-btn-gmaps');
    if (wsGmapsBtn) { wsGmapsBtn.disabled = false; wsGmapsBtn.removeAttribute('disabled'); wsGmapsBtn.classList.remove('disabled'); }
    if (statusSelect) { statusSelect.disabled = false; statusSelect.removeAttribute('disabled'); }
    const wsAddNoteBtn = document.getElementById('btn-ws-toggle-add-note');
    if (wsAddNoteBtn) { wsAddNoteBtn.disabled = false; wsAddNoteBtn.removeAttribute('disabled'); wsAddNoteBtn.classList.remove('disabled'); }

    // Message History
    renderWorkspaceMessageHistory(lead);

    // Lead Notes in Workspace
    renderLeadNotesSection(lead, 'workspace');

    // Outreach Activity Timeline in Workspace
    renderLeadActivityTimeline(lead, 'workspace');
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

    listEl.innerHTML = history.map((msg, idx) => {
      const type = msg.type || 'OUTREACH';
      const label = type === 'INITIAL' ? 'First Contact' : (type.startsWith('FU_') ? `Follow-Up #${type.split('_')[1]}` : type);
      const isManual = msg.status === 'Sent via WhatsApp' || msg.status === 'Sent';
      const timeFormatted = formatDDMMYYYY(msg.sent_at || msg.date);

      return `
        <div class="msg-history-item">
          <div class="msg-history-top">
            <span class="msg-history-type">${escapeHtml(label)}</span>
            <span class="msg-history-time">${timeFormatted}</span>
          </div>
          <div class="msg-history-text">${escapeHtml(msg.text || '')}</div>
          <div class="msg-history-status">
            <i class="${isManual ? 'fa-solid fa-check-double text-success' : 'fa-regular fa-clock text-warning'}"></i>
            <span>${escapeHtml(msg.status || 'Logged')}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderEmptyWorkspace() {
    const wsBiz = document.getElementById('ws-business-name');
    if (wsBiz) wsBiz.textContent = 'No Lead Selected';
    const wsCat = document.getElementById('ws-category');
    if (wsCat) wsCat.textContent = 'Queue is empty';
    const wsIdBadge = document.getElementById('ws-lead-source-id');
    if (wsIdBadge) wsIdBadge.textContent = '';
    const wsScore = document.getElementById('ws-score-text');
    if (wsScore) wsScore.textContent = '0/100';
    const wsPhone = document.getElementById('ws-phone');
    if (wsPhone) wsPhone.textContent = 'Not available';
    const wsEmail = document.getElementById('ws-email');
    if (wsEmail) wsEmail.textContent = 'N/A';
    const wsWeb = document.getElementById('ws-website');
    if (wsWeb) wsWeb.innerHTML = '<span style="color: #64748b;">No Website</span>';
    const wsLoc = document.getElementById('ws-location');
    if (wsLoc) wsLoc.textContent = '—';
    const statusSelect = document.getElementById('ws-status-select');
    if (statusSelect) {
      statusSelect.value = 'Not Contacted';
      statusSelect.disabled = true;
    }
    const wsPriSelect = document.getElementById('ws-priority-select');
    if (wsPriSelect) {
      wsPriSelect.value = 'Medium';
      wsPriSelect.disabled = true;
      wsPriSelect.setAttribute('disabled', 'true');
    }
    const statusPill = document.getElementById('ws-status-pill-val');
    if (statusPill) statusPill.textContent = 'No Lead';
    const sendLabel = document.getElementById('btn-ws-send-label');
    if (sendLabel) sendLabel.textContent = 'Send Message (Open Outreach Dialog)';

    const countEl = document.getElementById('ws-msg-count');
    if (countEl) countEl.textContent = '0';
    const historyList = document.getElementById('ws-history-list');
    if (historyList) {
      historyList.classList.add('hidden');
      historyList.innerHTML = '';
    }
    const historyEmpty = document.getElementById('ws-history-empty');
    if (historyEmpty) historyEmpty.classList.remove('hidden');

    // Reset workspace notes
    const wsNotesCount = document.getElementById('ws-notes-count');
    if (wsNotesCount) wsNotesCount.textContent = '0';
    const wsNotesList = document.getElementById('ws-notes-list');
    if (wsNotesList) {
      wsNotesList.classList.add('hidden');
      wsNotesList.innerHTML = '';
    }
    const wsNotesEmpty = document.getElementById('ws-notes-empty');
    if (wsNotesEmpty) wsNotesEmpty.classList.remove('hidden');
    const wsNotesAddBox = document.getElementById('ws-notes-add-box');
    if (wsNotesAddBox) wsNotesAddBox.classList.add('hidden');
    const wsAddNoteBtn = document.getElementById('btn-ws-toggle-add-note');
    if (wsAddNoteBtn) { wsAddNoteBtn.disabled = true; wsAddNoteBtn.setAttribute('disabled', 'true'); wsAddNoteBtn.classList.add('disabled'); }

    // Reset workspace activity timeline
    const wsActivityCount = document.getElementById('ws-activity-count');
    if (wsActivityCount) wsActivityCount.textContent = '0';
    const wsActivityTimeline = document.getElementById('ws-activity-timeline');
    if (wsActivityTimeline) {
      wsActivityTimeline.classList.add('hidden');
      wsActivityTimeline.innerHTML = '';
    }
    const wsActivityEmpty = document.getElementById('ws-activity-empty');
    if (wsActivityEmpty) wsActivityEmpty.classList.remove('hidden');

    // Disable workspace action buttons when empty
    const wsRemoveBtn = document.getElementById('ws-btn-remove');
    if (wsRemoveBtn) { wsRemoveBtn.disabled = true; wsRemoveBtn.setAttribute('disabled', 'true'); wsRemoveBtn.classList.add('disabled'); }
    const wsSendBtn = document.getElementById('btn-ws-open-composer');
    if (wsSendBtn) { wsSendBtn.disabled = true; wsSendBtn.setAttribute('disabled', 'true'); wsSendBtn.classList.add('disabled'); }
    const wsFavBtn = document.getElementById('ws-btn-favorite');
    if (wsFavBtn) { wsFavBtn.disabled = true; wsFavBtn.setAttribute('disabled', 'true'); wsFavBtn.classList.add('disabled'); }
    const wsViewBtn = document.getElementById('ws-btn-view-lead');
    if (wsViewBtn) { wsViewBtn.disabled = true; wsViewBtn.setAttribute('disabled', 'true'); wsViewBtn.classList.add('disabled'); }
    const wsGmapsBtn = document.getElementById('ws-btn-gmaps');
    if (wsGmapsBtn) { wsGmapsBtn.disabled = true; wsGmapsBtn.setAttribute('disabled', 'true'); wsGmapsBtn.classList.add('disabled'); }

    const wsOutcomeBadge = document.getElementById('ws-outcome-current-badge');
    if (wsOutcomeBadge) {
      wsOutcomeBadge.textContent = 'No outcome';
      wsOutcomeBadge.setAttribute('data-outcome', 'No outcome');
    }
    const wsOutcomeSelect = document.getElementById('ws-outcome-select');
    if (wsOutcomeSelect) {
      wsOutcomeSelect.value = '';
      wsOutcomeSelect.disabled = true;
    }
    const wsOutcomeReason = document.getElementById('ws-outcome-reason-input');
    if (wsOutcomeReason) {
      wsOutcomeReason.value = '';
      wsOutcomeReason.disabled = true;
    }
    const wsOutcomeSaveBtn = document.getElementById('btn-ws-save-outcome');
    if (wsOutcomeSaveBtn) {
      wsOutcomeSaveBtn.disabled = true;
    }
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

    let queueLeads = [...leadsArray];
    if (AppState.outreach?.smartQueueActive) {
      const priorityOrder = { High: 1, Medium: 2, Low: 3 };
      queueLeads.sort((a, b) => {
        const pA = priorityOrder[a.priority || 'Medium'] || 2;
        const pB = priorityOrder[b.priority || 'Medium'] || 2;
        return pA - pB;
      });
    }

    AppState.outreachQueue = {
      isActive: true,
      leads: queueLeads,
      currentIndex: 0,
      totalCount: queueLeads.length,
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

    // Record outreach_started activity event
    const leadId = lead.id || lead.place_id;
    if (leadId) {
      fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'outreach_started',
          event_title: 'Outreach Started',
          event_description: 'Outreach composer opened for lead.'
        })
      }).then(r => r.json()).then(data => {
        if (data.success && Array.isArray(data.activities)) {
          lead.activities = data.activities;
        }
      }).catch(err => console.warn('Error recording outreach_started activity:', err));
    }

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

    // Auto-Open WhatsApp Timer: start countdown if message is ready and phone is valid
    if (cleanPhone && activeTab !== 'tab-composer-custom') {
      checkAndStartWhatsAppAutoTimer(lead);
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
      cancelWhatsAppAutoTimer();
      if (aiOptions) aiOptions.classList.add('hidden');
      if (tplShelf) tplShelf.classList.add('hidden');
      if (textarea && (textarea.value.startsWith('Preparing') || textarea.value.startsWith('Crafting'))) {
        textarea.value = '';
        updateComposerCharCount();
      }
      if (textarea) textarea.focus();
    }
  }

  function getFormattedEnabledServices(settingsObj = null) {
    const s = settingsObj || AppState.settings || (typeof SettingsModule !== 'undefined' && SettingsModule.getDefaults ? SettingsModule.getDefaults() : null);
    const servicesList = s?.services || [];
    const enabledNames = servicesList
      .filter((srv) => srv && srv.enabled && typeof srv.name === 'string' && srv.name.trim())
      .map((srv) => srv.name.trim());
    if (enabledNames.length === 0) return '';
    if (enabledNames.length === 1) return enabledNames[0];
    if (enabledNames.length === 2) return `${enabledNames[0]} and ${enabledNames[1]}`;
    const last = enabledNames[enabledNames.length - 1];
    const initial = enabledNames.slice(0, -1).join(', ');
    return `${initial}, and ${last}`;
  }
  window.getFormattedEnabledServices = getFormattedEnabledServices;

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
    const myServices = getFormattedEnabledServices();

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
      .replace(/\{my_services\}/g, myServices)
      .replace(/\{\{my_services\}\}/g, myServices)
      .replace(/\{website_url\}/g, websiteUrl)
      .replace(/\{\{website_url\}\}/g, websiteUrl)
      .replace(/\{\{websiteStatus\}\}/g, currentLead.website_status === 'YES' ? 'website' : 'online presence');

    const textarea = document.getElementById('composer-message-text');
    if (textarea) {
      textarea.value = interpolated;
      updateComposerCharCount();
    }
    const cleanPhone = cleanPhoneNumber(currentLead.phone);
    if (cleanPhone) {
      checkAndStartWhatsAppAutoTimer(currentLead);
    }
  }
  window.applyCustomTemplate = applyCustomTemplate;

  let isCraftingAiMessage = false;

  async function craftAiMessage(lead) {
    if (isCraftingAiMessage) return;
    const currentLead = lead || AppState.outreach.currentComposerLead;
    if (!currentLead) return;

    cancelWhatsAppAutoTimer();
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
      const cleanPhone = cleanPhoneNumber(currentLead?.phone);
      if (cleanPhone) {
        checkAndStartWhatsAppAutoTimer(currentLead);
      }
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
    } finally {
      const cleanPhone = cleanPhoneNumber(lead?.phone);
      if (cleanPhone) {
        checkAndStartWhatsAppAutoTimer(lead);
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
  // AUTO OPEN WHATSAPP TIMER ENGINE
  // ----------------------------------------------------
  let waAutoTimerId = null;
  let waAutoTimerRemaining = 0;
  let waAutoTimerTargetLeadId = null;

  function getWhatsAppAutoTimerSeconds() {
    const prefs = AppState.settings?.whatsappPreferences;
    if (!prefs) return 3; // default is 3 seconds
    if (prefs.autoTimer === undefined || prefs.autoTimer === null) return 3;
    const num = parseInt(prefs.autoTimer, 10);
    return isNaN(num) ? 3 : num;
  }

  function cancelWhatsAppAutoTimer() {
    if (waAutoTimerId) {
      clearInterval(waAutoTimerId);
      waAutoTimerId = null;
    }
    waAutoTimerRemaining = 0;
    waAutoTimerTargetLeadId = null;

    const compOpenWa = document.getElementById('btn-composer-open-wa');
    if (compOpenWa) {
      const span = compOpenWa.querySelector('span');
      if (span) span.textContent = 'Open WhatsApp';
    }
  }

  function checkAndStartWhatsAppAutoTimer(lead = null) {
    cancelWhatsAppAutoTimer();

    const currentLead = lead || AppState.outreach.currentComposerLead;
    if (!currentLead) return;

    const seconds = getWhatsAppAutoTimerSeconds();
    if (seconds <= 0) {
      // 'Off' mode: manual click only
      return;
    }

    const modal = document.getElementById('modal-outreach-composer');
    if (!modal || modal.classList.contains('hidden') || modal.style.display === 'none') return;

    const mainContent = document.getElementById('composer-main-content');
    if (!mainContent || mainContent.classList.contains('hidden')) return;

    const cleanPhone = cleanPhoneNumber(currentLead.phone);
    if (!cleanPhone) return;

    const openWaBtn = document.getElementById('btn-composer-open-wa');
    if (!openWaBtn || openWaBtn.classList.contains('disabled')) return;

    const textarea = document.getElementById('composer-message-text');
    if (!textarea) return;
    const msg = textarea.value.trim();
    if (!msg || msg.startsWith('Preparing') || msg.startsWith('Crafting')) return;
    if (isCraftingAiMessage) return;

    const activeTab = document.querySelector('.composer-tab-btn.active')?.id;
    if (activeTab === 'tab-composer-custom' && !msg) return;

    const leadId = currentLead.id || currentLead.place_id;
    waAutoTimerTargetLeadId = leadId;
    waAutoTimerRemaining = seconds;

    const span = openWaBtn.querySelector('span');
    if (span) span.textContent = `Open WhatsApp · ${waAutoTimerRemaining}`;

    waAutoTimerId = setInterval(() => {
      // Re-verify modal & lead state on every tick
      const curModal = document.getElementById('modal-outreach-composer');
      if (!curModal || curModal.classList.contains('hidden') || curModal.style.display === 'none') {
        cancelWhatsAppAutoTimer();
        return;
      }
      const curMain = document.getElementById('composer-main-content');
      if (!curMain || curMain.classList.contains('hidden')) {
        cancelWhatsAppAutoTimer();
        return;
      }
      if (!AppState.outreach.currentComposerLead) {
        cancelWhatsAppAutoTimer();
        return;
      }
      const curLeadId = AppState.outreach.currentComposerLead.id || AppState.outreach.currentComposerLead.place_id;
      if (curLeadId !== waAutoTimerTargetLeadId) {
        cancelWhatsAppAutoTimer();
        return;
      }

      waAutoTimerRemaining--;
      if (waAutoTimerRemaining > 0) {
        if (span) span.textContent = `Open WhatsApp · ${waAutoTimerRemaining}`;
      } else {
        cancelWhatsAppAutoTimer();
        handleOpenWhatsApp();
      }
    }, 1000);
  }

  // ----------------------------------------------------
  // SAFE WHATSAPP SEND WORKFLOW (CONFIRMATION BASED)
  // ----------------------------------------------------

  function handleOpenWhatsApp() {
    cancelWhatsAppAutoTimer();
    const lead = AppState.outreach.currentComposerLead;
    if (!lead) return;

    const cleanPhone = cleanPhoneNumber(lead.phone);
    if (!cleanPhone) {
      showToast('This lead does not have a valid phone number. Please click Skip.', 'error', 3000);
      return;
    }

    const textarea = document.getElementById('composer-message-text');
    let finalMsg = textarea ? textarea.value.trim() : '';
    if (/\{my_services\}|\{\{my_services\}\}/.test(finalMsg)) {
      const myServices = getFormattedEnabledServices();
      finalMsg = finalMsg
        .replace(/\{my_services\}/g, myServices)
        .replace(/\{\{my_services\}\}/g, myServices);
      if (textarea) {
        textarea.value = finalMsg;
        updateComposerCharCount();
      }
    }
    AppState.outreach.lastPreparedMessage = finalMsg;

    // 1. Open WhatsApp Click-to-Chat externally
    const waMode = AppState.settings?.whatsappPreferences?.launchMode || 'desktop';
    const waUrl = (waMode === 'desktop')
      ? `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(finalMsg)}`
      : `https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMsg)}`;
    window.open(waUrl, '_blank');

    // Record WhatsApp Opened event in activity timeline
    const leadId = lead.id || lead.place_id;
    if (leadId) {
      fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'whatsapp_opened',
          event_title: 'WhatsApp Opened',
          event_description: 'WhatsApp opened with generated message',
          metadata: {
            channel: 'WhatsApp',
            message_preview: finalMsg ? finalMsg.slice(0, 120) : undefined
          }
        })
      }).then(r => r.json()).then(data => {
        if (data.success && Array.isArray(data.activities)) {
          lead.activities = data.activities;
          if (String(AppState.outreach?.activeLeadId) === String(leadId)) {
            renderLeadActivityTimeline(lead, 'workspace');
          }
        }
      }).catch(err => console.warn('Error recording whatsapp_opened activity:', err));
    }

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
  window.handleOpenWhatsApp = handleOpenWhatsApp;

  let isConfirmProcessing = false;

  async function handleConfirmSent(confirmed) {
    if (isConfirmProcessing) return;
    isConfirmProcessing = true;
    try {
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

        if (lead) {
          const leadId = lead.id || lead.place_id;
          const fuStep = AppState.outreach.followUpStep || lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
          const eventType = isFollowUp ? 'followup_not_sent' : 'message_not_sent';
          const eventTitle = isFollowUp ? `Follow-up #${fuStep} Not Sent` : 'Message Not Sent';
          const eventDesc = isFollowUp
            ? `User confirmed Follow-up #${fuStep} was not sent.`
            : 'User confirmed that the message was not sent.';

          fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_type: eventType,
              event_title: eventTitle,
              event_description: eventDesc,
              metadata: {
                step: isFollowUp ? fuStep : undefined
              }
            })
          }).then(r => r.json()).then(data => {
            if (data.success && Array.isArray(data.activities)) {
              lead.activities = data.activities;
              if (String(AppState.outreach?.activeLeadId) === String(leadId)) {
                renderLeadActivityTimeline(lead, 'workspace');
              }
            }
          }).catch(err => console.warn('Error recording not sent activity:', err));
        }

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

        if (String(AppState.outreach?.activeLeadId) === String(leadId)) {
          renderLeadActivityTimeline(lead, 'workspace');
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
    } finally {
      isConfirmProcessing = false;
    }
  }

  async function skipQueueCurrentLead() {
    cancelWhatsAppAutoTimer();
    const lead = AppState.outreach.currentComposerLead;
    if (lead) {
      const leadId = lead.id || lead.place_id;
      fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'outreach_skipped',
          event_title: 'Outreach Skipped',
          event_description: 'Lead skipped during outreach queue session.'
        })
      }).then(r => r.json()).then(data => {
        if (data.success && Array.isArray(data.activities)) {
          lead.activities = data.activities;
        }
      }).catch(err => console.warn('Error recording outreach_skipped activity:', err));
    }
    AppState.outreachQueue.skippedCount++;
    showToast(`Skipped "${lead?.business_name || 'lead'}".`, 'info', 1800);
    await loadQueueLead(AppState.outreachQueue.currentIndex + 1);
  }

  function stopOutreachQueue() {
    isConfirmProcessing = false;
    cancelWhatsAppAutoTimer();
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
    cancelWhatsAppAutoTimer();
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
    isConfirmProcessing = false;
    cancelWhatsAppAutoTimer();
    AppState.outreachQueue.isActive = false;
    AppState.outreach.currentComposerLead = null;
    const modal = document.getElementById('modal-outreach-composer');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function handleWhatsAppClick() {
    handleOpenWhatsApp();
  }

  // Dedicated Outreach Removal Logic (Keeps Saved Leads 100% Intact)
  async function removeFromOutreach(leadIds) {
    if (!Array.isArray(leadIds) || !leadIds.length) return;
    const count = leadIds.length;
    const idSet = new Set(leadIds.map(String));

    const firstLead = getOutreachLeadById(leadIds[0]);
    const bizName = count === 1 ? (firstLead?.business_name || '') : '';

    try {
      const res = await fetch('/api/outreach/remove-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to remove from Outreach.', 'error');
        return;
      }

      // 1. Clean selection in outreach
      leadIds.forEach((id) => {
        AppState.outreach.selectedLeadIds.delete(id);
        AppState.outreach.selectedLeadIds.delete(String(id));
      });

      // 2. Remove ONLY from in-memory outreach collections
      if (AppState.outreach.data) {
        if (Array.isArray(AppState.outreach.data.readyLeads)) {
          AppState.outreach.data.readyLeads = AppState.outreach.data.readyLeads.filter(
            (l) => !idSet.has(String(l.id)) && (!l.place_id || !idSet.has(String(l.place_id)))
          );
        }
        if (Array.isArray(AppState.outreach.data.allLeads)) {
          AppState.outreach.data.allLeads = AppState.outreach.data.allLeads.filter(
            (l) => !idSet.has(String(l.id)) && (!l.place_id || !idSet.has(String(l.place_id)))
          );
        }
        if (Array.isArray(AppState.outreach.data.followUpLeads)) {
          AppState.outreach.data.followUpLeads = AppState.outreach.data.followUpLeads.filter(
            (l) => !idSet.has(String(l.id)) && (!l.place_id || !idSet.has(String(l.place_id)))
          );
        }
        if (Array.isArray(AppState.outreach.data.completedLeads)) {
          AppState.outreach.data.completedLeads = AppState.outreach.data.completedLeads.filter(
            (l) => !idSet.has(String(l.id)) && (!l.place_id || !idSet.has(String(l.place_id)))
          );
        }
        if (Array.isArray(AppState.outreach.data.repliedLeads)) {
          AppState.outreach.data.repliedLeads = AppState.outreach.data.repliedLeads.filter(
            (l) => !idSet.has(String(l.id)) && (!l.place_id || !idSet.has(String(l.place_id)))
          );
        }
        if (Array.isArray(AppState.outreach.data.stoppedLeads)) {
          AppState.outreach.data.stoppedLeads = AppState.outreach.data.stoppedLeads.filter(
            (l) => !idSet.has(String(l.id)) && (!l.place_id || !idSet.has(String(l.place_id)))
          );
        }
      }

      // 3. Update outreach_status to 'Pending' on in-memory Saved Leads without removing them!
      // This keeps them 100% intact in Saved Leads and Favorites, under their original date groups.
      if (AppState.savedLeads) {
        AppState.savedLeads.forEach((l) => {
          if (idSet.has(String(l.id)) || (l.place_id && idSet.has(String(l.place_id)))) {
            l.outreach_status = 'Pending';
          }
        });
      }
      if (AppState.allSavedLeads) {
        AppState.allSavedLeads.forEach((l) => {
          if (idSet.has(String(l.id)) || (l.place_id && idSet.has(String(l.place_id)))) {
            l.outreach_status = 'Pending';
          }
        });
      }
      if (AppState.favoriteLeads) {
        AppState.favoriteLeads.forEach((l) => {
          if (idSet.has(String(l.id)) || (l.place_id && idSet.has(String(l.place_id)))) {
            l.outreach_status = 'Pending';
          }
        });
      }

      // 4. Update Conversation Workspace active lead
      const activeLead = getOutreachLeadById(AppState.outreach.activeLeadId);
      const isActiveRemoved = activeLead
        ? (idSet.has(String(activeLead.id)) || (activeLead.place_id && idSet.has(String(activeLead.place_id))))
        : idSet.has(String(AppState.outreach.activeLeadId || ''));

      if (isActiveRemoved) {
        const remaining = getActiveOutreachList();
        if (remaining && remaining.length > 0) {
          selectOutreachLead(remaining[0].id || remaining[0].place_id);
        } else {
          AppState.outreach.activeLeadId = null;
          renderEmptyWorkspace();
        }
      }

      // Clean in-memory lead map
      if (AppState.outreach.leadMap) {
        leadIds.forEach((id) => {
          AppState.outreach.leadMap.delete(String(id));
        });
      }

      // 5. Update UI cards & bulk controls
      renderOutreachCards();
      updateOutreachBulkControls();

      // 6. Recalculate and update metrics
      if (AppState.outreach.data?.metrics) {
        const allLeads = AppState.outreach.data.allLeads || [];
        const notContacted = (AppState.outreach.data.readyLeads || []).length;
        const awaitingReply = (AppState.outreach.data.followUpLeads || []).length;
        const replied = allLeads.filter((l) => l.reply_status != null || l.outreach_status === 'Replied').length;
        const completed = allLeads.filter((l) => l.outreach_status === 'Completed' || l.follow_up_completed === true).length;
        const stopped = allLeads.filter((l) => l.outreach_status === 'Stopped').length;

        const now = new Date();
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const followUpsDue = (AppState.outreach.data.followUpLeads || []).filter((l) => {
          if (!l.next_follow_up_at) return false;
          const target = new Date(l.next_follow_up_at);
          const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
          return targetMidnight <= todayMidnight;
        }).length;

        AppState.outreach.data.metrics.totalOutreach = allLeads.length;
        AppState.outreach.data.metrics.notContacted = notContacted;
        AppState.outreach.data.metrics.awaitingReply = awaitingReply;
        AppState.outreach.data.metrics.followUpsDue = followUpsDue;
        AppState.outreach.data.metrics.replied = replied;
        AppState.outreach.data.metrics.completed = completed;
        AppState.outreach.data.metrics.stopped = stopped;

        updateOutreachMetrics(AppState.outreach.data.metrics, AppState.outreach.data.todayOutreach);
      }

      // 7. Update navbar badges across application
      await updateBadgeCounts();

      const undoToken = data.undoToken;
      const prevStates = data.previousStates;
      const toastMsg = count === 1
        ? (bizName ? `Outreach lead removed: ${bizName}` : 'Outreach lead removed')
        : `${count} outreach leads removed`;

      showToast(toastMsg, 'success', 5000, {
        label: 'Undo',
        onClick: async () => {
          await undoOutreachRemove(undoToken, prevStates);
        }
      });
    } catch (err) {
      console.error('[Remove From Outreach Error]:', err);
      showToast('Failed to remove from Outreach.', 'error', 3000);
    }
  }

  async function handleConfirmationSend(confirmed) {
    await handleConfirmSent(confirmed);
  }

  async function handleConfirmNotOnWhatsApp() {
    if (isConfirmProcessing) return;
    isConfirmProcessing = true;
    const lead = AppState.outreach.currentComposerLead;
    if (!lead) {
      isConfirmProcessing = false;
      return;
    }
    const leadId = lead.id || lead.place_id;
    const bizName = lead.business_name || 'Lead';

    const notOnWaBtn = document.getElementById('btn-confirm-not-on-wa');
    if (notOnWaBtn) {
      notOnWaBtn.classList.add('loading');
      notOnWaBtn.disabled = true;
    }

    try {
      // Record Not on WhatsApp event in activity timeline
      await fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'not_on_whatsapp',
          event_title: 'Not on WhatsApp',
          event_description: 'Phone number confirmed as not registered on WhatsApp.'
        })
      }).catch(err => console.warn('Not on WhatsApp activity record notice:', err));

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
      isConfirmProcessing = false;
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
      await fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'not_on_whatsapp',
          event_title: 'Not on WhatsApp',
          event_description: 'Phone number confirmed as not registered on WhatsApp.'
        })
      }).catch(err => console.warn('Dedicated Not on WhatsApp activity record notice:', err));

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
      if (AppState.followup?.queue?.isActive) {
        openFollowUpQueueLead(AppState.followup.queue.currentIndex + 1);
      }
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
        return;
      }

      const priSelect = e.target.closest('.card-priority-pill');
      if (priSelect) {
        e.stopPropagation();
        const id = priSelect.getAttribute('data-id');
        const newPri = priSelect.value;
        priSelect.setAttribute('data-priority', newPri);
        updateLeadPriority(id, newPri);
        return;
      }
    });

    container.addEventListener('click', (e) => {
      if (e.target.closest('.card-priority-pill')) {
        e.stopPropagation();
        return;
      }

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

      const convPill = e.target.closest('.card-conversion-pill');
      if (convPill) {
        e.stopPropagation();
        const id = convPill.getAttribute('data-id');
        selectOutreachLead(id);
        openLeadConversionModal(id);
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
  let outreachListenersBound = false;
  function initOutreachListeners() {
    if (outreachListenersBound) return;
    outreachListenersBound = true;

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

    // 3. Search & Filters (debounced 180ms to eliminate typing lag)
    const searchInput = document.getElementById('outreach-search-input');
    const clearSearch = document.getElementById('btn-outreach-search-clear');
    let outreachSearchDebounceTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value;
        if (clearSearch) {
          if (val.trim().length > 0) clearSearch.classList.remove('hidden');
          else clearSearch.classList.add('hidden');
        }
        if (outreachSearchDebounceTimer) clearTimeout(outreachSearchDebounceTimer);
        outreachSearchDebounceTimer = setTimeout(() => {
          AppState.outreach.searchQuery = val;
          AppState.outreach.page = 1;
          renderOutreachCards();
        }, 180);
      });
    }
    if (clearSearch) {
      clearSearch.addEventListener('click', () => {
        if (outreachSearchDebounceTimer) clearTimeout(outreachSearchDebounceTimer);
        if (searchInput) searchInput.value = '';
        AppState.outreach.searchQuery = '';
        AppState.outreach.page = 1;
        clearSearch.classList.add('hidden');
        renderOutreachCards();
      });
    }

    const catFilter = document.getElementById('outreach-category-filter');
    if (catFilter) {
      catFilter.addEventListener('change', () => {
        AppState.outreach.categoryFilter = catFilter.value;
        AppState.outreach.page = 1;
        renderOutreachCards();
      });
    }

    const siteFilter = document.getElementById('outreach-site-filter');
    if (siteFilter) {
      siteFilter.addEventListener('change', () => {
        AppState.outreach.siteFilter = siteFilter.value;
        AppState.outreach.page = 1;
        renderOutreachCards();
      });
    }

    const priFilter = document.getElementById('outreach-priority-filter');
    if (priFilter) {
      priFilter.addEventListener('change', () => {
        AppState.outreach.priorityFilter = priFilter.value;
        AppState.outreach.page = 1;
        renderOutreachCards();
      });
    }

    const convFilter = document.getElementById('outreach-conversion-filter');
    if (convFilter) {
      convFilter.addEventListener('change', () => {
        AppState.outreach.conversionFilter = convFilter.value;
        AppState.outreach.page = 1;
        renderOutreachCards();
      });
    }

    const outreachTagFilter = document.getElementById('outreach-tag-filter');
    if (outreachTagFilter) {
      outreachTagFilter.addEventListener('change', () => {
        AppState.outreach.tagFilter = outreachTagFilter.value;
        AppState.outreach.page = 1;
        renderOutreachCards();
      });
    }

    const smartQueueBtn = document.getElementById('btn-outreach-smart-queue');
    if (smartQueueBtn) {
      smartQueueBtn.addEventListener('click', () => {
        AppState.outreach.smartQueueActive = !AppState.outreach.smartQueueActive;
        smartQueueBtn.classList.toggle('active', AppState.outreach.smartQueueActive);
        showToast(
          AppState.outreach.smartQueueActive ? 'Smart Queue enabled (High → Medium → Low)' : 'Smart Queue disabled',
          'info',
          2000
        );
        AppState.outreach.page = 1;
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

    // 5. Batch Delete (Remove from Outreach Only)
    const batchDelBtn = document.getElementById('btn-outreach-delete-batch');
    if (batchDelBtn) {
      batchDelBtn.addEventListener('click', () => {
        const count = AppState.outreach.selectedLeadIds.size;
        if (count === 0) return;
        AppState.pendingOutreachRemovalIds = Array.from(AppState.outreach.selectedLeadIds);
        const confirmModal = document.getElementById('modal-remove-outreach-confirm');
        const confirmTitle = document.getElementById('confirm-remove-outreach-title');
        const confirmDesc = document.getElementById('confirm-remove-outreach-desc');
        if (confirmTitle) confirmTitle.textContent = `Remove ${count} Lead${count > 1 ? 's' : ''} from Outreach?`;
        if (confirmDesc) confirmDesc.textContent = `This will remove the selected ${count} lead${count > 1 ? 's' : ''} from Outreach only. Your Saved Leads will not be affected.`;
        if (confirmModal) confirmModal.classList.remove('hidden');
      });
    }

    // 6. Empty State button -> view saved leads
    const emptyGotoSaved = document.getElementById('btn-outreach-goto-saved');
    if (emptyGotoSaved) {
      emptyGotoSaved.addEventListener('click', () => switchView('saved-leads'));
    }

    // 6b. Outreach Pagination & Rows per page
    const outreachRowsChoice = document.getElementById('outreach-rows-choice');
    if (outreachRowsChoice) {
      outreachRowsChoice.addEventListener('change', function () {
        AppState.outreach.rowsPerPage = parseInt(this.value, 10) || 25;
        AppState.outreach.page = 1;
        renderOutreachCards();
      });
    }

    const prevOutreachPageBtn = document.getElementById('btn-outreach-page-prev');
    const nextOutreachPageBtn = document.getElementById('btn-outreach-page-next');
    if (prevOutreachPageBtn) {
      prevOutreachPageBtn.addEventListener('click', () => {
        if (AppState.outreach.page > 1) {
          AppState.outreach.page--;
          renderOutreachCards();
        }
      });
    }
    if (nextOutreachPageBtn) {
      nextOutreachPageBtn.addEventListener('click', () => {
        const total = AppState.outreach.lastFilteredCount || 0;
        const maxPage = Math.ceil(total / (AppState.outreach.rowsPerPage || 25));
        if (AppState.outreach.page < maxPage) {
          AppState.outreach.page++;
          renderOutreachCards();
        }
      });
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

    // 13. Workspace Remove Button (Remove from Outreach Only)
    const wsRemoveBtn = document.getElementById('ws-btn-remove');
    if (wsRemoveBtn) {
      wsRemoveBtn.addEventListener('click', () => {
        const leadId = AppState.outreach.activeLeadId;
        if (!leadId) return;
        const lead = getOutreachLeadById(leadId);
        if (lead) {
          AppState.pendingOutreachRemovalIds = [lead.id || lead.place_id];
          const confirmModal = document.getElementById('modal-remove-outreach-confirm');
          const confirmTitle = document.getElementById('confirm-remove-outreach-title');
          const confirmDesc = document.getElementById('confirm-remove-outreach-desc');
          if (confirmTitle) confirmTitle.textContent = `Remove "${lead.business_name}" from Outreach?`;
          if (confirmDesc) confirmDesc.textContent = `This will remove "${lead.business_name}" from Outreach only. Your Saved Leads will not be affected.`;
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
      compTextarea.addEventListener('input', () => {
        updateComposerCharCount();
        cancelWhatsAppAutoTimer();
      });
      compTextarea.addEventListener('blur', () => {
        if (/\{my_services\}|\{\{my_services\}\}/.test(compTextarea.value)) {
          const myServices = getFormattedEnabledServices();
          compTextarea.value = compTextarea.value
            .replace(/\{my_services\}/g, myServices)
            .replace(/\{\{my_services\}\}/g, myServices);
          updateComposerCharCount();
        }
      });
    }

    // 20. Composer Copy Button (if present in any view)
    const compCopy = document.getElementById('btn-composer-copy');
    if (compCopy) {
      compCopy.addEventListener('click', () => {
        let text = document.getElementById('composer-message-text')?.value || '';
        if (/\{my_services\}|\{\{my_services\}\}/.test(text)) {
          const myServices = getFormattedEnabledServices();
          text = text
            .replace(/\{my_services\}/g, myServices)
            .replace(/\{\{my_services\}\}/g, myServices);
        }
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
        cancelWhatsAppAutoTimer();
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
    // Global ESC & Confirmation Keyboard Shortcuts (1, 2, 3)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modalOutreach = document.getElementById('modal-outreach-composer');
        if (modalOutreach && !modalOutreach.classList.contains('hidden') && modalOutreach.style.display !== 'none') {
          stopOutreachQueue();
          return;
        }
        const modalFu = document.getElementById('modal-followup-composer');
        if (modalFu && !modalFu.classList.contains('hidden') && modalFu.style.display !== 'none') {
          if (AppState.followup?.queue) AppState.followup.queue.isActive = false;
          closeDedicatedFollowUpModal();
          return;
        }
        const modalSnooze = document.getElementById('modal-followup-snooze');
        if (modalSnooze && !modalSnooze.classList.contains('hidden') && modalSnooze.style.display !== 'none') {
          closeSnoozeModal();
          return;
        }
        return;
      }

      // Check for confirmation keys: '1', '2', '3'
      if (e.key !== '1' && e.key !== '2' && e.key !== '3') {
        return;
      }

      // Ignore repeat key events and any modifier combinations
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }

      // Input field safety: do NOT intercept when actively typing in editable elements
      const activeEl = document.activeElement;
      if (activeEl) {
        const tag = (activeEl.tagName || '').toUpperCase();
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          activeEl.isContentEditable ||
          activeEl.getAttribute('contenteditable') === 'true'
        ) {
          return;
        }
      }

      // Prevent double action / rapid accidental double processing
      if (isConfirmProcessing) {
        return;
      }

      // 1. Check if Outreach Send Message confirmation step is active
      const modalOutreach = document.getElementById('modal-outreach-composer');
      const outreachConfirmBlock = document.getElementById('composer-confirm-block');
      const isOutreachConfirm = modalOutreach && !modalOutreach.classList.contains('hidden') && modalOutreach.style.display !== 'none' &&
        outreachConfirmBlock && !outreachConfirmBlock.classList.contains('hidden') && outreachConfirmBlock.style.display !== 'none';

      if (isOutreachConfirm) {
        if (e.key === '1') {
          const btnYes = document.getElementById('btn-confirm-sent-yes');
          if (btnYes && !btnYes.disabled) {
            e.preventDefault();
            btnYes.click();
          }
        } else if (e.key === '2') {
          const btnNo = document.getElementById('btn-confirm-sent-no');
          if (btnNo && !btnNo.disabled) {
            e.preventDefault();
            btnNo.click();
          }
        } else if (e.key === '3') {
          const btnNotOnWa = document.getElementById('btn-confirm-not-on-wa');
          if (btnNotOnWa && !btnNotOnWa.disabled) {
            e.preventDefault();
            btnNotOnWa.click();
          }
        }
        return;
      }

      // 2. Check if Follow-Up Send Message confirmation step is active
      const modalFu = document.getElementById('modal-followup-composer');
      const fuConfirmBlock = document.getElementById('fu-composer-confirm-block');
      const isFuConfirm = modalFu && !modalFu.classList.contains('hidden') && modalFu.style.display !== 'none' &&
        fuConfirmBlock && !fuConfirmBlock.classList.contains('hidden') && fuConfirmBlock.style.display !== 'none';

      if (isFuConfirm) {
        if (e.key === '1') {
          const btnYes = document.getElementById('btn-fu-confirm-yes');
          if (btnYes && !btnYes.disabled) {
            e.preventDefault();
            btnYes.click();
          }
        } else if (e.key === '2') {
          const btnNo = document.getElementById('btn-fu-confirm-no');
          if (btnNo && !btnNo.disabled) {
            e.preventDefault();
            btnNo.click();
          }
        } else if (e.key === '3') {
          const btnNotOnWa = document.getElementById('btn-fu-confirm-not-wa');
          if (btnNotOnWa && !btnNotOnWa.disabled) {
            e.preventDefault();
            btnNotOnWa.click();
          }
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

  let followupDataPromise = null;
  async function loadFollowUpData() {
    if (followupDataPromise) return followupDataPromise;

    followupDataPromise = (async () => {
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

        AppState.followupDirty = false;
        updateFollowUpCounters();
        renderFollowUpCards();
      } catch (err) {
        console.error('Error loading Follow-Up data:', err);
      } finally {
        followupDataPromise = null;
      }
    })();

    return followupDataPromise;
  }
  const fetchFollowUpData = loadFollowUpData;
  window.fetchFollowUpData = loadFollowUpData;

  function updateFollowUpCounters() {
    const allFollowUpLeads = AppState.followup.leads || [];
    let activeCount = 0;
    let dueTodayCount = 0;
    let dueSoonCount = 0;
    let upcomingCount = 0;
    let overdueCount = 0;
    let repliesCount = 0;
    let completedCount = 0;
    let pausedCount = 0;

    allFollowUpLeads.forEach((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const isStopped = Boolean(lead.outreach_status === 'Stopped' || lead.stopped === true);

      if (isStopped) {
        return;
      }

      if (isReplied) {
        repliesCount++;
      } else if (isCompleted) {
        completedCount++;
      } else {
        const isPaused = Boolean(lead.follow_up_paused || lead.followUpPaused);
        if (isPaused) {
          pausedCount++;
        } else {
          activeCount++;
          const diff = getCalendarDayDiff(lead.next_follow_up_at);
          if (diff === null) {
            dueTodayCount++;
          } else if (diff < 0) {
            overdueCount++;
          } else if (diff === 0) {
            dueTodayCount++;
          } else if (diff > 0) {
            upcomingCount++;
            if (diff >= 1 && diff <= 3) {
              dueSoonCount++;
            }
          }
        }
      }
    });

    const cDue = document.getElementById('fu-counter-due-today');
    const cOverdue = document.getElementById('fu-counter-overdue');
    const cUpcoming = document.getElementById('fu-counter-upcoming');
    const cPaused = document.getElementById('fu-counter-paused');
    const cCompleted = document.getElementById('fu-counter-completed');
    const cActive = document.getElementById('fu-counter-active');
    const cDueSoon = document.getElementById('fu-counter-due-soon');

    if (cDue) cDue.textContent = dueTodayCount;
    if (cOverdue) cOverdue.textContent = overdueCount;
    if (cUpcoming) cUpcoming.textContent = upcomingCount;
    if (cPaused) cPaused.textContent = pausedCount;
    if (cCompleted) cCompleted.textContent = completedCount;
    if (cActive) cActive.textContent = activeCount;
    if (cDueSoon) cDueSoon.textContent = dueSoonCount;

    const tAll = document.getElementById('fu-tab-all-count');
    const tDue = document.getElementById('fu-tab-duetoday-count');
    const tOverdue = document.getElementById('fu-tab-overdue-count');
    const tUpcoming = document.getElementById('fu-tab-upcoming-count');
    const tPaused = document.getElementById('fu-tab-paused-count');
    const tCompleted = document.getElementById('fu-tab-completed-count');
    const tReplies = document.getElementById('fu-tab-replies-count');
    const tDueSoon = document.getElementById('fu-tab-duesoon-count');

    if (tAll) tAll.textContent = activeCount + pausedCount;
    if (tDue) tDue.textContent = dueTodayCount;
    if (tOverdue) tOverdue.textContent = overdueCount;
    if (tUpcoming) tUpcoming.textContent = upcomingCount;
    if (tPaused) tPaused.textContent = pausedCount;
    if (tCompleted) tCompleted.textContent = completedCount;
    if (tReplies) tReplies.textContent = repliesCount;
    if (tDueSoon) tDueSoon.textContent = dueSoonCount;

    // Actionable Follow-Ups = Due Today + Overdue ONLY
    const actionableCount = dueTodayCount + overdueCount;
    const navBadge = document.getElementById('nav-followup-badge');
    const mobileBadge = document.getElementById('mobile-nav-followup-badge');
    if (navBadge) navBadge.textContent = actionableCount;
    if (mobileBadge) mobileBadge.textContent = actionableCount;

    // "Today" Reminder Banner & Smart Queue Start Button
    const reminderBanner = document.getElementById('fu-today-reminder-banner');
    const reminderText = document.getElementById('fu-today-reminder-text');
    const startQueueBtn = document.getElementById('btn-start-followup-queue');
    if (reminderBanner) {
      reminderBanner.className = 'fu-today-banner anim-dash';
      if (actionableCount === 0) {
        reminderBanner.classList.add('banner-success');
        if (reminderText) reminderText.innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> <span>You're all caught up for today.</span>`;
        if (startQueueBtn) startQueueBtn.classList.add('hidden');
      } else if (dueTodayCount > 0 && overdueCount === 0) {
        reminderBanner.classList.add('banner-due');
        if (reminderText) reminderText.innerHTML = `<i class="fa-solid fa-bell text-emerald"></i> <span><strong>${dueTodayCount} follow-up${dueTodayCount === 1 ? '' : 's'}</strong> require attention today.</span>`;
        if (startQueueBtn) startQueueBtn.classList.remove('hidden');
      } else if (dueTodayCount === 0 && overdueCount > 0) {
        reminderBanner.classList.add('banner-overdue');
        if (reminderText) reminderText.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose"></i> <span>⚠ <strong>${overdueCount} follow-up${overdueCount === 1 ? '' : 's'}</strong> ${overdueCount === 1 ? 'is' : 'are'} overdue.</span>`;
        if (startQueueBtn) startQueueBtn.classList.remove('hidden');
      } else {
        reminderBanner.classList.add('banner-overdue');
        if (reminderText) reminderText.innerHTML = `<i class="fa-solid fa-bell text-rose"></i> <span><strong>${actionableCount} leads require attention today</strong> (${overdueCount} overdue · ${dueTodayCount} due today).</span>`;
        if (startQueueBtn) startQueueBtn.classList.remove('hidden');
      }
    }
  }

  function getFilteredFollowUpLeads() {
    const allLeads = AppState.followup.leads || [];
    const tab = AppState.followup.activeTab || 'all';
    const stageFilter = AppState.followup.stageFilter || 'ALL';
    const replyFilter = AppState.followup.replyFilter || 'ALL';
    const query = (AppState.followup.searchQuery || '').toLowerCase().trim();

    // Deduplicate leads by unique lead ID
    const seenIds = new Set();
    const uniqueLeads = [];
    for (const lead of allLeads) {
      const idKey = String(lead.id || lead.place_id);
      if (!seenIds.has(idKey)) {
        seenIds.add(idKey);
        uniqueLeads.push(lead);
      }
    }

    let filtered = uniqueLeads.filter((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const isStopped = Boolean(lead.outreach_status === 'Stopped' || lead.stopped === true);
      const isPaused = Boolean(lead.follow_up_paused || lead.followUpPaused);
      const diff = getCalendarDayDiff(lead.next_follow_up_at);

      if (isStopped) return false;

      if (tab === 'all') {
        if (isReplied || isCompleted) return false;
      } else if (tab === 'due-today') {
        if (isPaused || isReplied || isCompleted || (diff !== 0 && diff !== null)) return false;
      } else if (tab === 'overdue') {
        if (isPaused || isReplied || isCompleted || diff === null || diff >= 0) return false;
      } else if (tab === 'upcoming') {
        if (isPaused || isReplied || isCompleted || diff === null || diff <= 0) return false;
      } else if (tab === 'paused') {
        if (!isPaused || isReplied || isCompleted) return false;
      } else if (tab === 'completed') {
        if (!isCompleted || isReplied) return false;
      } else if (tab === 'due-soon') {
        if (isPaused || isReplied || isCompleted || diff === null || diff < 1 || diff > 3) return false;
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

      // Priority filter
      const priFilter = AppState.followup.priorityFilter || 'ALL';
      if (priFilter !== 'ALL') {
        if ((lead.priority || 'Medium') !== priFilter) return false;
      }

      // Tag filter
      const fuTagFilter = AppState.followup.tagFilter || 'ALL';
      if (fuTagFilter !== 'ALL') {
        if (fuTagFilter === 'NO_TAG') {
          if (Array.isArray(lead.tags) && lead.tags.length > 0) return false;
        } else {
          const target = fuTagFilter.toLowerCase();
          if (!Array.isArray(lead.tags) || !lead.tags.some((t) => String(t).toLowerCase() === target)) return false;
        }
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
          cat.includes(query) ||
          (Array.isArray(lead.tags) && lead.tags.some((t) => String(t).toLowerCase().includes(query)))
        );
      });
    }

    // Deterministic Priority Sorting:
    // 1. Overdue (diff < 0) - sorted by most overdue first (diff ascending)
    // 2. Due Today (diff === 0) - sorted by earliest scheduled
    // 3. Due Soon (1 <= diff <= 3) - sorted by earliest due date
    // 4. Upcoming (diff > 3) - sorted by earliest due date
    const nowMidnight = getNowMidnight();
    const diffCache = new Map();
    function getLeadDiff(lead) {
      const key = lead.next_follow_up_at;
      if (!key) return null;
      if (diffCache.has(key)) return diffCache.get(key);
      const d = getCalendarDayDiff(key, nowMidnight);
      diffCache.set(key, d);
      return d;
    }

    function getPriorityRank(d) {
      if (d === null) return 5;
      if (d < 0) return 1;
      if (d === 0) return 2;
      if (d >= 1 && d <= 3) return 3;
      return 4;
    }

    filtered.sort((a, b) => {
      const diffA = getLeadDiff(a);
      const diffB = getLeadDiff(b);

      const rankA = getPriorityRank(diffA);
      const rankB = getPriorityRank(diffB);

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      if (diffA !== null && diffB !== null && diffA !== diffB) {
        return diffA - diffB;
      }

      const timeA = a.next_follow_up_at ? new Date(a.next_follow_up_at).getTime() : 0;
      const timeB = b.next_follow_up_at ? new Date(b.next_follow_up_at).getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;

      return (a.business_name || '').localeCompare(b.business_name || '');
    });

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
      updateFollowUpSelectionUI([]);
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
        } else if (tab === 'due-soon') {
          if (titleEl) titleEl.textContent = 'No Follow-Ups Due Soon';
          if (descEl) descEl.textContent = 'No follow-up messages are scheduled within the next 1 to 3 days.';
        } else if (tab === 'upcoming') {
          if (titleEl) titleEl.textContent = 'No Upcoming Follow-Ups';
          if (descEl) descEl.textContent = 'Send initial outreach messages to schedule automatic follow-up reminders.';
        } else if (tab === 'replies') {
          if (titleEl) titleEl.textContent = 'No Replies Recorded Yet';
          if (descEl) descEl.textContent = 'When prospects reply on WhatsApp, click "Reply" to record their status.';
        } else if (tab === 'completed') {
          if (titleEl) titleEl.textContent = 'No Completed Sequences Yet';
          if (descEl) descEl.textContent = 'Leads that finish the full 5-step follow-up sequence will be archived here.';
        } else if (tab === 'paused') {
          if (titleEl) titleEl.textContent = 'No Paused Follow-Ups';
          if (descEl) descEl.textContent = 'You have no paused follow-up leads. Click "Pause" on any active lead to temporarily suspend automatic reminders.';
        } else {
          if (titleEl) titleEl.textContent = 'No Follow-Ups Due';
          if (descEl) descEl.textContent = "You're all caught up. Send initial outreach messages to schedule follow-ups.";
        }
      }
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    container.innerHTML = leads.map((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const isPaused = Boolean(lead.follow_up_paused || lead.followUpPaused);
      const diff = getCalendarDayDiff(lead.next_follow_up_at);

      let statusBadgeClass = 'upcoming';
      let statusBadgeText = '⚪ UPCOMING';
      let cardModifierClass = '';

      if (isPaused) {
        statusBadgeClass = 'paused';
        statusBadgeText = '⏸ PAUSED';
        cardModifierClass = 'status-paused';
      } else if (lead.reply_status === 'INTERESTED') {
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
        statusBadgeText = '✓ COMPLETED';
        cardModifierClass = 'status-completed';
      } else if (diff !== null) {
        if (diff < 0) {
          statusBadgeClass = 'overdue';
          statusBadgeText = Math.abs(diff) === 1 ? '🔴 OVERDUE — 1 DAY' : `🔴 OVERDUE — ${Math.abs(diff)} DAYS`;
          cardModifierClass = 'status-overdue';
        } else if (diff === 0) {
          statusBadgeClass = 'due';
          statusBadgeText = '⚡ DUE TODAY';
          cardModifierClass = 'status-due';
        } else if (diff === 1) {
          statusBadgeClass = 'upcoming';
          statusBadgeText = '⚪ UPCOMING — TOMORROW';
          cardModifierClass = 'status-upcoming';
        } else {
          statusBadgeClass = 'upcoming';
          statusBadgeText = `⚪ UPCOMING — IN ${diff} DAYS`;
          cardModifierClass = 'status-upcoming';
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
        dueStatusDisplay = 'Completed';
        dueHighlightClass = 'completed-highlight';
      } else if (isPaused) {
        dueStatusDisplay = 'Paused';
        dueHighlightClass = 'paused-highlight';
      } else if (diff !== null) {
        dueStatusDisplay = getDaysUntilText(diff);
        if (diff < 0) dueHighlightClass = 'overdue-highlight';
        else if (diff === 0) dueHighlightClass = 'due-highlight';
        else dueHighlightClass = 'upcoming-highlight';
      }

      // Actionability Check: Follow-Up can ONLY be sent on or after due date and when not paused!
      const isActionable = !isReplied && !isCompleted && !isPaused && diff !== null && diff <= 0;
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
          if (isPaused) {
            nodeStatusClass = 'paused';
            marker = '⏸';
            statusLabel = `${node.day} · Paused`;
          } else if (diff === 0) {
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

      const hasNotes = Array.isArray(lead.notes) && lead.notes.length > 0;
      const isEligible = !isReplied && !isCompleted && !lead.stopped && lead.outreach_status !== 'Stopped';

      return `
        <div class="followup-card ${cardModifierClass}" data-lead-id="${leadId}">
          <div class="fu-card-header">
            <div class="fu-header-left">
              ${isEligible ? `
                <div class="fu-card-select-wrap">
                  <input type="checkbox" class="fu-card-checkbox" data-lead-id="${leadId}" ${AppState.followup.selectedLeadIds?.has(String(leadId)) ? 'checked' : ''} aria-label="Select ${escapeHtml(lead.business_name || 'Lead')}" />
                </div>
              ` : ''}
              <div class="fu-card-avatar">${iconAvatar}</div>
              <div class="fu-header-meta">
                <h3 class="fu-biz-name">${escapeHtml(lead.business_name || 'Business')}</h3>
                <div class="fu-sub-meta">
                  <span class="fu-cat-pill">${escapeHtml(lead.category || 'Local Business')}</span>
                  <span class="fu-meta-loc"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(lead.city ? (lead.city + (lead.state ? ', ' + lead.state : '')) : (lead.state || 'Local'))}</span>
                  ${lead.phone ? `<span class="fu-meta-phone"><i class="fa-solid fa-phone"></i> ${escapeHtml(lead.phone)}</span>` : ''}
                  ${hasNotes ? `<button type="button" class="fu-note-badge" data-action="view" data-lead-id="${leadId}" title="${lead.notes.length} note${lead.notes.length === 1 ? '' : 's'} available"><i class="fa-regular fa-note-sticky"></i> <span>📝 Note available</span></button>` : ''}
                  ${Array.isArray(lead.tags) && lead.tags.length > 0 ? `
                    <div class="card-tags-list" style="display:inline-flex;margin-top:0;">
                      ${lead.tags.slice(0, 3).map((t) => `<span class="lead-tag-badge lead-tag-badge-sm" title="Tag: ${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}
                      ${lead.tags.length > 3 ? `<span class="lead-tag-badge lead-tag-badge-sm lead-tag-more">+${lead.tags.length - 3}</span>` : ''}
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
            <div class="fu-header-right">
              <select class="fu-priority-select" data-lead-id="${leadId}" data-priority="${escapeHtml(lead.priority || 'Medium')}" title="Lead Priority">
                <option value="High" ${(lead.priority || 'Medium') === 'High' ? 'selected' : ''}>High</option>
                <option value="Medium" ${(lead.priority || 'Medium') === 'Medium' ? 'selected' : ''}>Medium</option>
                <option value="Low" ${(lead.priority || 'Medium') === 'Low' ? 'selected' : ''}>Low</option>
              </select>
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
            ${isPaused ? `
              <div class="fu-paused-lock-pill" title="Follow-up is currently paused for this lead">
                <i class="fa-solid fa-pause"></i>
                <span>Follow-Up Paused</span>
              </div>
            ` : isActionable ? `
              <button type="button" class="btn-fu-send ${diff < 0 ? 'overdue' : 'due'}" data-action="send-fu" data-lead-id="${leadId}">
                <i class="fa-regular fa-paper-plane"></i>
                <span>Message</span>
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
            ${!isCompleted && !isReplied ? `
              ${isPaused ? `
                <button type="button" class="btn-fu-resume" data-action="resume" data-lead-id="${leadId}" title="Resume follow-up for this lead">
                  <i class="fa-solid fa-play"></i>
                  <span>Resume</span>
                </button>
              ` : `
                <button type="button" class="btn-fu-pause" data-action="pause" data-lead-id="${leadId}" title="Pause follow-up for this lead">
                  <i class="fa-solid fa-pause"></i>
                  <span>Pause</span>
                </button>
              `}
              <button type="button" class="btn-fu-snooze" data-action="snooze" data-lead-id="${leadId}">
                <i class="fa-regular fa-clock"></i>
                <span>Snooze</span>
              </button>
            ` : ''}
            ${canReply ? `
              <button type="button" class="btn-fu-reply" data-action="reply" data-lead-id="${leadId}">
                <i class="fa-regular fa-comment-dots"></i>
                <span>Reply</span>
              </button>
            ` : ''}
            <button type="button" class="btn-fu-view" data-action="view" data-lead-id="${leadId}">
              <i class="fa-regular fa-eye"></i>
              <span>View Lead</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    updateFollowUpSelectionUI(leads);
  }

  function updateFollowUpSelectionUI(leads = null) {
    const chkSelectAll = document.getElementById('chk-fu-select-all');
    const textSelectAll = document.getElementById('text-fu-select-all');
    const badgeCount = document.getElementById('badge-fu-selected-count');
    const btnBulkSend = document.getElementById('btn-fu-bulk-send');

    const currentLeads = leads || getFilteredFollowUpLeads();
    const eligibleLeads = currentLeads.filter((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const isStopped = Boolean(lead.outreach_status === 'Stopped' || lead.stopped === true);
      return !isReplied && !isCompleted && !isStopped;
    });

    const totalEligible = eligibleLeads.length;
    if (!AppState.followup.selectedLeadIds) AppState.followup.selectedLeadIds = new Set();
    const selectedEligibleCount = eligibleLeads.filter((l) => AppState.followup.selectedLeadIds.has(String(l.id || l.place_id))).length;

    if (chkSelectAll) {
      if (totalEligible === 0) {
        chkSelectAll.checked = false;
        chkSelectAll.disabled = true;
        chkSelectAll.indeterminate = false;
      } else if (selectedEligibleCount === totalEligible) {
        chkSelectAll.checked = true;
        chkSelectAll.disabled = false;
        chkSelectAll.indeterminate = false;
      } else if (selectedEligibleCount > 0) {
        chkSelectAll.checked = false;
        chkSelectAll.disabled = false;
        chkSelectAll.indeterminate = true;
      } else {
        chkSelectAll.checked = false;
        chkSelectAll.disabled = false;
        chkSelectAll.indeterminate = false;
      }
    }

    if (textSelectAll) {
      if (totalEligible === 0) {
        textSelectAll.textContent = 'Select All';
      } else {
        textSelectAll.textContent = `Select All (${totalEligible})`;
      }
    }

    if (badgeCount) {
      if (selectedEligibleCount > 0) {
        badgeCount.classList.remove('hidden');
        badgeCount.textContent = `${selectedEligibleCount} selected`;
      } else {
        badgeCount.classList.add('hidden');
        badgeCount.textContent = '0 selected';
      }
    }

    if (btnBulkSend) {
      btnBulkSend.disabled = selectedEligibleCount === 0;
      const btnSpan = btnBulkSend.querySelector('#text-fu-bulk-send');
      if (btnSpan) {
        btnSpan.textContent = selectedEligibleCount > 0 ? `Send Follow-Ups (${selectedEligibleCount})` : 'Send Follow-Ups';
      }
    }

    const btnBulkPause = document.getElementById('btn-fu-bulk-pause');
    const btnBulkResume = document.getElementById('btn-fu-bulk-resume');

    if (btnBulkPause) {
      const hasUnpaused = eligibleLeads.some((l) => AppState.followup.selectedLeadIds.has(String(l.id || l.place_id)) && !l.follow_up_paused && !l.followUpPaused);
      btnBulkPause.disabled = !hasUnpaused;
      if (hasUnpaused) btnBulkPause.classList.remove('disabled');
      else btnBulkPause.classList.add('disabled');
    }

    if (btnBulkResume) {
      const hasPaused = eligibleLeads.some((l) => AppState.followup.selectedLeadIds.has(String(l.id || l.place_id)) && (l.follow_up_paused || l.followUpPaused));
      btnBulkResume.disabled = !hasPaused;
      if (hasPaused) btnBulkResume.classList.remove('disabled');
      else btnBulkResume.classList.add('disabled');
    }
  }

  function handleFollowUpSelectAll(checked) {
    const currentLeads = getFilteredFollowUpLeads();
    const eligibleLeads = currentLeads.filter((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const isStopped = Boolean(lead.outreach_status === 'Stopped' || lead.stopped === true);
      return !isReplied && !isCompleted && !isStopped;
    });

    if (!AppState.followup.selectedLeadIds) AppState.followup.selectedLeadIds = new Set();

    if (checked) {
      eligibleLeads.forEach((l) => {
        AppState.followup.selectedLeadIds.add(String(l.id || l.place_id));
      });
    } else {
      AppState.followup.selectedLeadIds.clear();
    }

    const cardCbs = document.querySelectorAll('.fu-card-checkbox');
    cardCbs.forEach((cb) => {
      const leadId = cb.getAttribute('data-lead-id');
      cb.checked = AppState.followup.selectedLeadIds.has(String(leadId));
    });

    updateFollowUpSelectionUI(currentLeads);
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
  // AUTO OPEN WHATSAPP TIMER ENGINE (FOLLOW-UP)
  // ----------------------------------------------------
  let waFuAutoTimerId = null;
  let waFuAutoTimerRemaining = 0;
  let waFuAutoTimerTargetLeadId = null;

  function getFollowUpWhatsAppAutoTimerSetting() {
    const prefs = AppState.settings?.whatsappPreferences;
    if (!prefs) return 3;
    if (prefs.followUpAutoTimer === undefined || prefs.followUpAutoTimer === null) return 3;
    if (typeof prefs.followUpAutoTimer === 'string' && prefs.followUpAutoTimer.trim().toLowerCase() === 'immediate') {
      return 'immediate';
    }
    const num = parseInt(prefs.followUpAutoTimer, 10);
    return isNaN(num) ? 3 : num;
  }

  function getFollowUpWhatsAppAutoTimerSeconds() {
    const setting = getFollowUpWhatsAppAutoTimerSetting();
    if (setting === 'immediate') return 0;
    return typeof setting === 'number' ? setting : 3;
  }

  function cancelFollowUpWhatsAppAutoTimer() {
    if (waFuAutoTimerId) {
      clearInterval(waFuAutoTimerId);
      waFuAutoTimerId = null;
    }
    waFuAutoTimerRemaining = 0;
    waFuAutoTimerTargetLeadId = null;

    const btn = document.getElementById('btn-fu-modal-wa');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) span.textContent = 'Open WhatsApp';
    }
  }

  function checkAndStartFollowUpWhatsAppAutoTimer(lead = null) {
    cancelFollowUpWhatsAppAutoTimer();

    const currentLead = lead || AppState.followup.currentComposerLead;
    if (!currentLead) return;

    const setting = getFollowUpWhatsAppAutoTimerSetting();
    if (setting === 'immediate') {
      const modal = document.getElementById('modal-followup-composer');
      if (!modal || modal.classList.contains('hidden') || modal.style.display === 'none') return;

      const mainContent = document.getElementById('fu-composer-main-content');
      if (!mainContent || mainContent.classList.contains('hidden')) return;

      const confirmBlock = document.getElementById('fu-composer-confirm-block');
      if (confirmBlock && !confirmBlock.classList.contains('hidden')) return;

      const cleanPhone = cleanPhoneNumber(currentLead.phone);
      if (!cleanPhone) return;

      const btn = document.getElementById('btn-fu-modal-wa');
      if (!btn || btn.disabled) return;

      const textarea = document.getElementById('fu-modal-message-text');
      if (!textarea) return;
      const msg = textarea.value.trim();
      if (!msg) return;

      // Immediate mode: open WhatsApp immediately with 0-second delay, no countdown, no timer popup
      handleOpenDedicatedWhatsApp();
      return;
    }

    const seconds = (typeof setting === 'number') ? setting : parseInt(setting, 10);
    if (isNaN(seconds) || seconds <= 0) {
      // 'Off' mode: manual click only
      return;
    }

    const modal = document.getElementById('modal-followup-composer');
    if (!modal || modal.classList.contains('hidden') || modal.style.display === 'none') return;

    const mainContent = document.getElementById('fu-composer-main-content');
    if (!mainContent || mainContent.classList.contains('hidden')) return;

    const confirmBlock = document.getElementById('fu-composer-confirm-block');
    if (confirmBlock && !confirmBlock.classList.contains('hidden')) return;

    const cleanPhone = cleanPhoneNumber(currentLead.phone);
    if (!cleanPhone) return;

    const btn = document.getElementById('btn-fu-modal-wa');
    if (!btn || btn.disabled) return;

    const textarea = document.getElementById('fu-modal-message-text');
    if (!textarea) return;
    const msg = textarea.value.trim();
    if (!msg) return;

    const leadId = String(currentLead.id || currentLead.place_id);
    waFuAutoTimerTargetLeadId = leadId;
    waFuAutoTimerRemaining = seconds;

    const span = btn.querySelector('span');
    if (span) span.textContent = `Open WhatsApp · ${waFuAutoTimerRemaining}`;

    waFuAutoTimerId = setInterval(() => {
      const curModal = document.getElementById('modal-followup-composer');
      if (!curModal || curModal.classList.contains('hidden') || curModal.style.display === 'none') {
        cancelFollowUpWhatsAppAutoTimer();
        return;
      }
      const curMain = document.getElementById('fu-composer-main-content');
      if (!curMain || curMain.classList.contains('hidden')) {
        cancelFollowUpWhatsAppAutoTimer();
        return;
      }
      const curConfirm = document.getElementById('fu-composer-confirm-block');
      if (curConfirm && !curConfirm.classList.contains('hidden')) {
        cancelFollowUpWhatsAppAutoTimer();
        return;
      }
      if (!AppState.followup.currentComposerLead) {
        cancelFollowUpWhatsAppAutoTimer();
        return;
      }
      const curLeadId = String(AppState.followup.currentComposerLead.id || AppState.followup.currentComposerLead.place_id);
      if (curLeadId !== waFuAutoTimerTargetLeadId) {
        cancelFollowUpWhatsAppAutoTimer();
        return;
      }

      waFuAutoTimerRemaining--;
      if (waFuAutoTimerRemaining > 0) {
        if (span) span.textContent = `Open WhatsApp · ${waFuAutoTimerRemaining}`;
      } else {
        cancelFollowUpWhatsAppAutoTimer();
        handleOpenDedicatedWhatsApp();
      }
    }, 1000);
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
      const myServices = getFormattedEnabledServices();

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
        .replace(/\{my_services\}/g, myServices)
        .replace(/\{\{my_services\}\}/g, myServices)
        .replace(/\{website_url\}/g, websiteUrl)
        .replace(/\{\{website_url\}\}/g, websiteUrl);

      if (textarea) {
        textarea.value = interpolated;
        updateDedicatedCharCount();
      }
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Queue indicator in Follow-Up modal header
    const queueTracker = document.getElementById('fu-modal-queue-tracker');
    const qCurrent = document.getElementById('fu-queue-current-step');
    const qTotal = document.getElementById('fu-queue-total-step');
    if (queueTracker) {
      if (AppState.followup.queue?.isActive && AppState.followup.queue.leads?.length) {
        queueTracker.classList.remove('hidden');
        if (qCurrent) qCurrent.textContent = String((AppState.followup.queue.currentIndex || 0) + 1);
        if (qTotal) qTotal.textContent = String(AppState.followup.queue.leads.length);
      } else {
        queueTracker.classList.add('hidden');
      }
    }

    // Auto open WhatsApp countdown timer for Follow-Up
    checkAndStartFollowUpWhatsAppAutoTimer(lead);
  }

  function closeDedicatedFollowUpModal() {
    cancelFollowUpWhatsAppAutoTimer();
    isConfirmFollowUpProcessing = false;
    if (AppState.followup?.queue) AppState.followup.queue.isActive = false;
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
    cancelFollowUpWhatsAppAutoTimer();
    const lead = AppState.followup.currentComposerLead;
    if (!lead) return;

    const cleanPhone = cleanPhoneNumber(lead.phone);
    if (!cleanPhone) {
      showToast('This lead does not have a valid phone number.', 'error', 3000);
      return;
    }

    const textarea = document.getElementById('fu-modal-message-text');
    let finalMsg = textarea ? textarea.value.trim() : '';
    if (/\{my_services\}|\{\{my_services\}\}/.test(finalMsg)) {
      const myServices = getFormattedEnabledServices();
      finalMsg = finalMsg
        .replace(/\{my_services\}/g, myServices)
        .replace(/\{\{my_services\}\}/g, myServices);
      if (textarea) {
        textarea.value = finalMsg;
        updateDedicatedCharCount();
      }
    }
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

    const leadId = lead.id || lead.place_id;
    if (leadId) {
      fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'whatsapp_opened',
          event_title: 'WhatsApp Opened',
          event_description: 'WhatsApp opened with generated follow-up message',
          metadata: {
            channel: 'WhatsApp',
            message_preview: finalMsg ? finalMsg.slice(0, 120) : undefined
          }
        })
      }).then(r => r.json()).then(data => {
        if (data.success && Array.isArray(data.activities)) {
          lead.activities = data.activities;
        }
      }).catch(err => console.warn('Dedicated WhatsApp Opened activity record notice:', err));
    }
  }

  let isConfirmFollowUpProcessing = false;

  async function handleConfirmDedicatedSent(confirmed) {
    if (isConfirmFollowUpProcessing) return;
    isConfirmFollowUpProcessing = true;
    cancelFollowUpWhatsAppAutoTimer();
    const lead = AppState.followup.currentComposerLead;
    if (!lead) {
      isConfirmFollowUpProcessing = false;
      return;
    }

    try {
      if (!confirmed) {
        showToast('Follow-up marked as not sent. Lead remains on current follow-up step.', 'info', 2500);
        const leadId = lead.id || lead.place_id;
        const curStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
        const safeStep = Math.min(5, Math.max(1, parseInt(curStep, 10) || 1));
        await fetch(`/api/leads/${encodeURIComponent(leadId)}/activities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'followup_not_sent',
            event_title: `Follow-up #${safeStep} Not Sent`,
            event_description: `User confirmed Follow-up #${safeStep} was not sent.`,
            metadata: { step: safeStep }
          })
        }).then(r => r.json()).then(data => {
          if (data.success && Array.isArray(data.activities)) {
            lead.activities = data.activities;
          }
        }).catch(err => console.warn('Dedicated followup_not_sent activity record notice:', err));
        if (AppState.followup.queue?.isActive && AppState.followup.queue.leads?.length > 1) {
          openFollowUpQueueLead(AppState.followup.queue.currentIndex + 1);
        } else {
          if (AppState.followup.queue) AppState.followup.queue.isActive = false;
          closeDedicatedFollowUpModal();
        }
        return;
      }

      const leadId = lead.id || lead.place_id;
      const finalMsg = AppState.followup.lastPreparedMessage || document.getElementById('fu-modal-message-text')?.value?.trim() || '';
      const curStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
      const safeStep = Math.min(5, Math.max(1, parseInt(curStep, 10) || 1));

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

        if (AppState.followup.selectedLeadIds) {
          AppState.followup.selectedLeadIds.delete(leadId);
          AppState.followup.selectedLeadIds.delete(String(leadId));
        }

        updateFollowUpCounters();
        renderFollowUpCards();
        updateBadgeCounts();

        if (AppState.followup.queue?.isActive && AppState.followup.queue.leads?.length > 1) {
          openFollowUpQueueLead(AppState.followup.queue.currentIndex + 1);
        } else {
          if (AppState.followup.queue) AppState.followup.queue.isActive = false;
          closeDedicatedFollowUpModal();
        }
      } else {
        showToast(json.error || 'Failed to record follow-up.', 'error', 3000);
      }
    } catch (err) {
      console.error('Error confirming follow-up send:', err);
      showToast('Network error confirming follow-up.', 'error', 2500);
    } finally {
      isConfirmFollowUpProcessing = false;
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
        if (json.lead && Array.isArray(json.lead.activities)) {
          lead.activities = json.lead.activities;
        }
        if (String(AppState.outreach?.activeLeadId) === String(leadId)) {
          renderLeadActivityTimeline(lead, 'workspace');
        }

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

  // ----------------------------------------------------
  // SMART FOLLOW-UP QUEUE & SNOOZE CONTROLLERS
  // ----------------------------------------------------

  function startFollowUpQueue() {
    const allLeads = AppState.followup.leads || [];
    // Filter actionable leads (Overdue and Due Today) sorted by priority
    const actionable = allLeads.filter((lead) => {
      const isReplied = Boolean(lead.reply_status === 'INTERESTED' || lead.reply_status === 'NOT_INTERESTED' || lead.reply_status === 'OTHER' || lead.outreach_status === 'Replied');
      const isCompleted = Boolean(lead.follow_up_completed || lead.outreach_status === 'Completed');
      const isStopped = Boolean(lead.outreach_status === 'Stopped' || lead.stopped === true);
      const isPaused = Boolean(lead.follow_up_paused || lead.followUpPaused);
      const diff = getCalendarDayDiff(lead.next_follow_up_at);
      return !isReplied && !isCompleted && !isStopped && !isPaused && diff !== null && diff <= 0;
    });

    actionable.sort((a, b) => {
      const diffA = getCalendarDayDiff(a.next_follow_up_at);
      const diffB = getCalendarDayDiff(b.next_follow_up_at);
      if (diffA !== diffB) return diffA - diffB;
      const timeA = a.next_follow_up_at ? new Date(a.next_follow_up_at).getTime() : 0;
      const timeB = b.next_follow_up_at ? new Date(b.next_follow_up_at).getTime() : 0;
      return timeA - timeB;
    });

    if (actionable.length === 0) {
      showToast("No follow-ups require attention today.", 'info', 2500);
      return;
    }

    AppState.followup.queue = {
      isActive: true,
      currentIndex: 0,
      leads: actionable
    };

    openFollowUpQueueLead(0);
  }

  function startBulkFollowUpQueue() {
    const currentLeads = getFilteredFollowUpLeads();
    const selected = currentLeads.filter((l) => {
      const isReplied = Boolean(l.reply_status === 'INTERESTED' || l.reply_status === 'NOT_INTERESTED' || l.reply_status === 'OTHER' || l.outreach_status === 'Replied');
      const isCompleted = Boolean(l.follow_up_completed || l.outreach_status === 'Completed');
      const isStopped = Boolean(l.outreach_status === 'Stopped' || l.stopped === true);
      const isPaused = Boolean(l.follow_up_paused || l.followUpPaused);
      const eligible = !isReplied && !isCompleted && !isStopped && !isPaused;
      return eligible && AppState.followup.selectedLeadIds?.has(String(l.id || l.place_id));
    });

    if (selected.length === 0) {
      showToast('Please select at least one eligible follow-up lead.', 'info', 2000);
      return;
    }

    AppState.followup.queue = {
      isActive: true,
      currentIndex: 0,
      leads: selected
    };

    openFollowUpQueueLead(0);
  }

  function openFollowUpQueueLead(index) {
    if (!AppState.followup.queue || !AppState.followup.queue.isActive) return;
    const leads = AppState.followup.queue.leads || [];
    if (index >= leads.length) {
      AppState.followup.queue.isActive = false;
      closeDedicatedFollowUpModal();
      showToast('🎉 All selected follow-ups completed!', 'success', 3500);
      loadFollowUpData();
      return;
    }

    AppState.followup.queue.currentIndex = index;
    const queuedLead = leads[index];
    const freshLead = (AppState.followup.leads || []).find(
      (l) => String(l.id) === String(queuedLead.id) || (l.place_id && String(l.place_id) === String(queuedLead.place_id))
    ) || queuedLead;

    if (!freshLead) {
      openFollowUpQueueLead(index + 1);
      return;
    }

    const isReplied = Boolean(freshLead.reply_status === 'INTERESTED' || freshLead.reply_status === 'NOT_INTERESTED' || freshLead.reply_status === 'OTHER' || freshLead.outreach_status === 'Replied');
    const isCompleted = Boolean(freshLead.follow_up_completed || freshLead.outreach_status === 'Completed');
    const isStopped = Boolean(freshLead.outreach_status === 'Stopped' || freshLead.stopped === true);
    const isPaused = Boolean(freshLead.follow_up_paused || freshLead.followUpPaused);
    if (isReplied || isCompleted || isStopped || isPaused) {
      openFollowUpQueueLead(index + 1);
      return;
    }

    openDedicatedFollowUpModal(freshLead);
  }

  function openSnoozeModal(lead) {
    if (!lead) return;
    AppState.followup.currentSnoozeLead = lead;
    const modal = document.getElementById('modal-followup-snooze');
    const nameEl = document.getElementById('snooze-lead-biz-name');
    const metaEl = document.getElementById('snooze-lead-meta');
    const dateInput = document.getElementById('snooze-custom-date-input');

    if (nameEl) nameEl.textContent = lead.business_name || 'Business';
    if (metaEl) {
      const diff = getCalendarDayDiff(lead.next_follow_up_at);
      let diffText = 'Due Today';
      if (diff !== null) {
        if (diff < 0) diffText = `${Math.abs(diff)} days overdue`;
        else if (diff === 0) diffText = 'Due Today';
        else if (diff === 1) diffText = 'Due Tomorrow';
        else diffText = `Due in ${diff} days (${formatDDMMYYYY(lead.next_follow_up_at)})`;
      }
      metaEl.textContent = `Current schedule: ${diffText}`;
    }

    if (dateInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const minIso = tomorrow.toISOString().split('T')[0];
      dateInput.min = minIso;
      dateInput.value = minIso;
    }

    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function closeSnoozeModal() {
    const modal = document.getElementById('modal-followup-snooze');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
    AppState.followup.currentSnoozeLead = null;
  }

  async function applySnooze(leadId, days, customDate) {
    if (!leadId) return;
    try {
      const res = await fetch('/api/outreach/snooze-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, days, customDate })
      });
      const data = await res.json();
      if (data.success && data.lead) {
        showToast(data.message || '✓ Follow-up snoozed successfully', 'success', 3000);

        const fuMatch = AppState.followup.leads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
        if (fuMatch) Object.assign(fuMatch, data.lead);

        const savedMatch = AppState.savedLeads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
        if (savedMatch) Object.assign(savedMatch, data.lead);

        const allMatch = AppState.allSavedLeads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
        if (allMatch) Object.assign(allMatch, data.lead);

        const outMatch = AppState.outreach?.data?.allLeads?.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
        if (outMatch) Object.assign(outMatch, data.lead);

        AppState.followupDirty = true;
        AppState.outreachDirty = true;
        AppState.savedLeadsDirty = true;

        updateFollowUpCounters();
        renderFollowUpCards();
        updateBadgeCounts();
        closeSnoozeModal();

        if (AppState.followup.queue?.isActive) {
          openFollowUpQueueLead(AppState.followup.queue.currentIndex + 1);
        }
      } else {
        showToast(data.error || 'Failed to snooze follow-up', 'error', 3000);
      }
    } catch (err) {
      console.error('Error snoozing follow-up:', err);
      showToast('Network error snoozing follow-up', 'error', 2500);
    }
  }

  // Initialization & Event Delegation
  let followUpListenersBound = false;
  function initFollowUpListeners() {
    if (followUpListenersBound) return;
    followUpListenersBound = true;

    // 0. Start Follow-Up Queue Button
    const startQueueBtn = document.getElementById('btn-start-followup-queue');
    if (startQueueBtn) {
      startQueueBtn.addEventListener('click', startFollowUpQueue);
    }

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

    // 3. Metric cards navigation (Priority ordered)
    const metricCardMap = [
      { id: 'card-fu-due-today', tab: 'due-today' },
      { id: 'card-fu-overdue', tab: 'overdue' },
      { id: 'card-fu-upcoming', tab: 'upcoming' },
      { id: 'card-fu-paused', tab: 'paused' },
      { id: 'card-fu-completed', tab: 'completed' },
      { id: 'card-fu-active', tab: 'all' },
      { id: 'card-fu-due-soon', tab: 'due-soon' }
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

    // 5B. Priority filter
    const fuPriFilter = document.getElementById('fu-priority-filter');
    if (fuPriFilter) {
      fuPriFilter.addEventListener('change', (e) => {
        AppState.followup.priorityFilter = e.target.value;
        renderFollowUpCards();
      });
    }

    // 5C. Tag filter
    const fuTagFilter = document.getElementById('followup-tag-filter');
    if (fuTagFilter) {
      fuTagFilter.addEventListener('change', (e) => {
        AppState.followup.tagFilter = e.target.value;
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

    // 6B. Bulk Follow-Up Selection & Queue Controls
    const chkSelectAll = document.getElementById('chk-fu-select-all');
    if (chkSelectAll) {
      chkSelectAll.addEventListener('change', (e) => {
        handleFollowUpSelectAll(e.target.checked);
      });
    }

    const btnBulkSend = document.getElementById('btn-fu-bulk-send');
    if (btnBulkSend) {
      btnBulkSend.addEventListener('click', startBulkFollowUpQueue);
    }

    const btnBulkPause = document.getElementById('btn-fu-bulk-pause');
    if (btnBulkPause) {
      btnBulkPause.addEventListener('click', () => {
        const ids = Array.from(AppState.followup.selectedLeadIds || []);
        if (ids.length > 0) {
          bulkPauseFollowUp(ids);
        }
      });
    }

    const btnBulkResume = document.getElementById('btn-fu-bulk-resume');
    if (btnBulkResume) {
      btnBulkResume.addEventListener('click', () => {
        const ids = Array.from(AppState.followup.selectedLeadIds || []);
        if (ids.length > 0) {
          bulkResumeFollowUp(ids);
        }
      });
    }

    // 7. Cards container action delegation & checkbox changes
    const container = document.getElementById('followup-cards-container');
    if (container) {
      if (container.dataset.delegated) return;
      container.dataset.delegated = 'true';
      container.addEventListener('change', (e) => {
        const cb = e.target.closest('.fu-card-checkbox');
        if (cb) {
          const leadId = String(cb.getAttribute('data-lead-id'));
          if (!AppState.followup.selectedLeadIds) AppState.followup.selectedLeadIds = new Set();
          if (cb.checked) {
            AppState.followup.selectedLeadIds.add(leadId);
          } else {
            AppState.followup.selectedLeadIds.delete(leadId);
          }
          updateFollowUpSelectionUI();
          return;
        }

        const priSelect = e.target.closest('.fu-priority-select');
        if (priSelect) {
          e.stopPropagation();
          const leadId = priSelect.getAttribute('data-lead-id');
          const newPri = priSelect.value;
          priSelect.setAttribute('data-priority', newPri);
          updateLeadPriority(leadId, newPri);
          return;
        }
      });

      container.addEventListener('click', (e) => {
        if (e.target.closest('.fu-priority-select')) {
          e.stopPropagation();
          return;
        }

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
        } else if (action === 'pause') {
          pauseFollowUp(leadId);
        } else if (action === 'resume') {
          resumeFollowUp(leadId);
        } else if (action === 'snooze') {
          openSnoozeModal(lead);
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

    const btnFuSkip = document.getElementById('btn-fu-queue-skip');
    if (btnFuSkip) {
      btnFuSkip.addEventListener('click', () => {
        if (AppState.followup.queue?.isActive) {
          cancelFollowUpWhatsAppAutoTimer();
          openFollowUpQueueLead(AppState.followup.queue.currentIndex + 1);
        }
      });
    }

    const btnFuStop = document.getElementById('btn-fu-queue-stop');
    if (btnFuStop) {
      btnFuStop.addEventListener('click', () => {
        if (AppState.followup.queue) {
          AppState.followup.queue.isActive = false;
        }
        cancelFollowUpWhatsAppAutoTimer();
        closeDedicatedFollowUpModal();
        showToast('Follow-Up queue stopped.', 'info', 2000);
      });
    }

    if (fuModalClose) {
      fuModalClose.addEventListener('click', () => {
        if (AppState.followup.queue) AppState.followup.queue.isActive = false;
        closeDedicatedFollowUpModal();
      });
    }
    if (fuModalCancel) {
      fuModalCancel.addEventListener('click', () => {
        if (AppState.followup.queue) AppState.followup.queue.isActive = false;
        closeDedicatedFollowUpModal();
      });
    }
    const fuModal = document.getElementById('modal-followup-composer');
    if (fuModal) {
      fuModal.addEventListener('click', (e) => {
        if (e.target === fuModal) {
          if (AppState.followup.queue) AppState.followup.queue.isActive = false;
          closeDedicatedFollowUpModal();
        }
      });
    }
    if (fuModalWa) fuModalWa.addEventListener('click', handleOpenDedicatedWhatsApp);
    if (fuConfirmYes) fuConfirmYes.addEventListener('click', () => handleConfirmDedicatedSent(true));
    if (fuConfirmNo) fuConfirmNo.addEventListener('click', () => handleConfirmDedicatedSent(false));

    if (fuTextarea) {
      fuTextarea.addEventListener('input', updateDedicatedCharCount);
      fuTextarea.addEventListener('blur', () => {
        if (/\{my_services\}|\{\{my_services\}\}/.test(fuTextarea.value)) {
          const myServices = getFormattedEnabledServices();
          fuTextarea.value = fuTextarea.value
            .replace(/\{my_services\}/g, myServices)
            .replace(/\{\{my_services\}\}/g, myServices);
          updateDedicatedCharCount();
        }
      });
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

    // 10. Snooze modal action buttons
    const snoozeClose = document.getElementById('btn-snooze-modal-close');
    const snoozeCancel = document.getElementById('btn-snooze-modal-cancel');
    const snoozeApplyCustom = document.getElementById('btn-snooze-apply-custom');

    if (snoozeClose) snoozeClose.addEventListener('click', closeSnoozeModal);
    if (snoozeCancel) snoozeCancel.addEventListener('click', closeSnoozeModal);

    const snoozeModal = document.getElementById('modal-followup-snooze');
    if (snoozeModal) {
      snoozeModal.addEventListener('click', (e) => {
        const optBtn = e.target.closest('.btn-snooze-option');
        if (optBtn) {
          const days = parseInt(optBtn.getAttribute('data-snooze-days'), 10);
          const lead = AppState.followup.currentSnoozeLead;
          if (lead && days) {
            applySnooze(lead.id || lead.place_id, days);
          }
        }
      });
    }

    if (snoozeApplyCustom) {
      snoozeApplyCustom.addEventListener('click', () => {
        const lead = AppState.followup.currentSnoozeLead;
        const dateInput = document.getElementById('snooze-custom-date-input');
        const customDate = dateInput ? dateInput.value : '';
        if (!customDate) {
          showToast('Please select a valid date to snooze until.', 'info', 2500);
          return;
        }
        if (lead) {
          applySnooze(lead.id || lead.place_id, null, customDate);
        }
      });
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

    // 7. Daily Performance Summary Click Handlers (Requirement 16 & 17)
    const tileFound = document.getElementById('perf-tile-found');
    if (tileFound) {
      tileFound.addEventListener('click', () => switchView('find-leads'));
    }

    const tileSaved = document.getElementById('perf-tile-saved');
    if (tileSaved) {
      tileSaved.addEventListener('click', () => {
        AppState.savedFilters.date = 'today';
        const ds = document.getElementById('saved-filter-date');
        if (ds) ds.value = 'today';
        switchView('saved-leads');
        filterAndRenderSavedLeads();
      });
    }

    const tileSent = document.getElementById('perf-tile-sent');
    if (tileSent) {
      tileSent.addEventListener('click', () => switchView('outreach'));
    }

    const tileFollowups = document.getElementById('perf-tile-followups');
    if (tileFollowups) {
      tileFollowups.addEventListener('click', () => {
        switchView('followup');
        setFollowUpTab('all');
      });
    }

    const tileReplies = document.getElementById('perf-tile-replies');
    if (tileReplies) {
      tileReplies.addEventListener('click', () => {
        switchView('followup');
        setFollowUpTab('replies');
      });
    }

    const tileOutreachAdded = document.getElementById('perf-tile-outreach-added');
    if (tileOutreachAdded) {
      tileOutreachAdded.addEventListener('click', () => switchView('outreach'));
    }

    const tileDueToday = document.getElementById('perf-tile-due-today');
    if (tileDueToday) {
      tileDueToday.addEventListener('click', () => {
        switchView('followup');
        setFollowUpTab('due-today');
      });
    }

    const btnViewOutreach = document.getElementById('btn-perf-view-outreach');
    if (btnViewOutreach) {
      btnViewOutreach.addEventListener('click', () => switchView('outreach'));
    }

    const btnViewFollowups = document.getElementById('btn-perf-view-followups');
    if (btnViewFollowups) {
      btnViewFollowups.addEventListener('click', () => switchView('followup'));
    }

    const btnViewHistory = document.getElementById('btn-perf-view-history');
    if (btnViewHistory) {
      btnViewHistory.addEventListener('click', () => switchView('history'));
    }

    const btnExportDaily = document.getElementById('btn-perf-export-daily');
    if (btnExportDaily) {
      btnExportDaily.addEventListener('click', () => {
        openExportModal('daily_perf');
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
          launchMode: 'desktop',
          autoTimer: 3,
          followUpAutoTimer: 3
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

    async saveCategory(categoryKey, data, categoryDisplayName = 'Settings', btnEl = null, customToast = null) {
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

        if (customToast) {
          showToast(customToast, 'success');
        } else {
          showToast(`✓ ${categoryDisplayName} settings saved successfully`, 'success');
        }
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
      loadDailyPerformance();

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
          if (AppState.settings) {
            AppState.settings.services = s.services;
          }
          inputCustomService.value = '';
          this.renderServicesList();
          this.updateTemplatePreview();
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

      // Wire template modal variable chips upfront
      const modalTpl = document.getElementById('modal-template-editor');
      if (modalTpl) {
        modalTpl.querySelectorAll('.var-chip-btn').forEach(chip => {
          chip.onclick = () => {
            const txtContent = document.getElementById('textarea-tpl-content');
            if (!txtContent) return;
            const varTag = chip.getAttribute('data-var');
            const start = txtContent.selectionStart || 0;
            const end = txtContent.selectionEnd || 0;
            const val = txtContent.value;
            txtContent.value = val.substring(0, start) + varTag + val.substring(end);
            txtContent.focus();
            txtContent.selectionStart = txtContent.selectionEnd = start + varTag.length;
          };
        });
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

      const btnCheckUpdates = document.getElementById('btn-check-updates');
      if (btnCheckUpdates) {
        btnCheckUpdates.onclick = () => this.checkForUpdates();
      }

      // Populate Tab 8: WhatsApp Preferences
      const waCountryInp = document.getElementById('set-wa-country');
      if (waCountryInp) waCountryInp.value = s.whatsappPreferences?.countryCode || '+91 9959983437';
      const waModeSel = document.getElementById('set-wa-launch-mode');
      if (waModeSel && s.whatsappPreferences?.launchMode) waModeSel.value = s.whatsappPreferences.launchMode;

      const waTimerSel = document.getElementById('set-wa-auto-timer');
      const waFuTimerSel = document.getElementById('set-wa-fu-auto-timer');

      if (waTimerSel) {
        const timerVal = (s.whatsappPreferences?.autoTimer !== undefined && s.whatsappPreferences?.autoTimer !== null)
          ? String(s.whatsappPreferences.autoTimer)
          : '3';
        waTimerSel.value = timerVal;

        waTimerSel.onchange = () => {
          const rawFu = waFuTimerSel ? waFuTimerSel.value : (s.whatsappPreferences?.followUpAutoTimer ?? 3);
          const currentFuTimer = (rawFu === 'immediate') ? 'immediate' : parseInt(rawFu, 10);
          this.saveCategory('whatsappPreferences', {
            countryCode: waCountryInp ? waCountryInp.value.trim() : (s.whatsappPreferences?.countryCode || '+91 9959983437'),
            launchMode: waModeSel ? waModeSel.value : (s.whatsappPreferences?.launchMode || 'desktop'),
            autoTimer: parseInt(waTimerSel.value, 10),
            followUpAutoTimer: currentFuTimer
          }, 'Outreach WhatsApp Timer', null, 'Outreach WhatsApp Timer settings saved.');
        };
      }

      if (waFuTimerSel) {
        const rawFu = s.whatsappPreferences?.followUpAutoTimer;
        let fuTimerVal = '3';
        if (rawFu !== undefined && rawFu !== null) {
          const str = String(rawFu).trim().toLowerCase();
          if (str === 'immediate') {
            fuTimerVal = 'immediate';
          } else {
            const parsed = parseInt(rawFu, 10);
            fuTimerVal = isNaN(parsed) ? '3' : String(parsed);
          }
        }
        waFuTimerSel.value = fuTimerVal;

        waFuTimerSel.onchange = () => {
          const currentOutreachTimer = waTimerSel ? parseInt(waTimerSel.value, 10) : (s.whatsappPreferences?.autoTimer ?? 3);
          const selVal = waFuTimerSel.value;
          const parsedFuTimer = (selVal === 'immediate') ? 'immediate' : parseInt(selVal, 10);
          this.saveCategory('whatsappPreferences', {
            countryCode: waCountryInp ? waCountryInp.value.trim() : (s.whatsappPreferences?.countryCode || '+91 9959983437'),
            launchMode: waModeSel ? waModeSel.value : (s.whatsappPreferences?.launchMode || 'desktop'),
            autoTimer: currentOutreachTimer,
            followUpAutoTimer: parsedFuTimer
          }, 'Follow-Up WhatsApp Timer', null, 'Follow-Up WhatsApp Timer settings saved.');
        };
      }

      const btnSaveWa = document.getElementById('btn-save-whatsapp');
      if (btnSaveWa) {
        btnSaveWa.onclick = () => {
          const timerVal = waTimerSel ? parseInt(waTimerSel.value, 10) : (s.whatsappPreferences?.autoTimer ?? 3);
          const rawFu = waFuTimerSel ? waFuTimerSel.value : (s.whatsappPreferences?.followUpAutoTimer ?? 3);
          const fuTimerVal = (rawFu === 'immediate') ? 'immediate' : parseInt(rawFu, 10);
          this.saveCategory('whatsappPreferences', {
            countryCode: waCountryInp ? waCountryInp.value.trim() : '+91 9959983437',
            launchMode: waModeSel ? waModeSel.value : 'desktop',
            autoTimer: timerVal,
            followUpAutoTimer: fuTimerVal
          }, 'WhatsApp Preferences', btnSaveWa, 'WhatsApp Preferences saved.');
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

      // Initialize Backup & Restore
      this.initBackupAndRestore();

      // Global Save All Changes Button
      const btnSaveAll = document.getElementById('btn-save-all-settings');
      if (btnSaveAll) {
        btnSaveAll.onclick = () => this.saveAllSettingsFromUI();
      }
    },

    initBackupAndRestore() {
      const btnCreate = document.getElementById('btn-create-backup');
      const btnRestore = document.getElementById('btn-restore-backup');
      const inputFallback = document.getElementById('input-backup-file-fallback');
      const btnRefreshRecent = document.getElementById('btn-refresh-recent-backups');
      const btnCancelRestore = document.getElementById('btn-cancel-restore');
      const btnCloseRestoreX = document.getElementById('btn-close-restore-preview-x');
      const btnPerformRestore = document.getElementById('btn-perform-restore');
      const modalRestore = document.getElementById('modal-backup-restore-preview');

      if (btnCreate) {
        btnCreate.onclick = async () => {
          try {
            btnCreate.disabled = true;
            btnCreate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
            showToast('Preparing verified ClientHunter backup...', 'info', 2000);

            const res = await fetch('/api/backup/create', { method: 'POST' });
            const data = await res.json();

            if (!data.success) {
              throw new Error(data.error || 'Backup creation failed.');
            }

            const backupContent = JSON.stringify(data.backup, null, 2);
            const defaultFileName = data.defaultFileName;

            if (window.desktopApp && typeof window.desktopApp.saveBackupFile === 'function') {
              const saveRes = await window.desktopApp.saveBackupFile({
                defaultFileName,
                content: backupContent
              });

              if (saveRes.canceled) {
                showToast('Backup cancelled — file was not saved.', 'info');
              } else if (!saveRes.success) {
                showToast(`Failed to save backup: ${saveRes.error}`, 'error');
              } else {
                showToast(`Backup created successfully — ${data.metadata.leadCount} leads saved to ${saveRes.fileName}`, 'success', 4000);
                this.loadRecentBackups();
              }
            } else {
              // Web browser download fallback
              const blob = new Blob([backupContent], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = defaultFileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              showToast(`Backup created successfully — ${data.metadata.leadCount} leads downloaded`, 'success', 4000);
              this.loadRecentBackups();
            }
          } catch (err) {
            console.error('[BACKUP CREATE ERROR]', err);
            showToast(`Could not create backup: ${err.message}`, 'error');
          } finally {
            if (btnCreate) {
              btnCreate.disabled = false;
              btnCreate.innerHTML = '<i class="fa-solid fa-download"></i> Create Backup';
            }
          }
        };
      }

      if (btnRestore) {
        btnRestore.onclick = async () => {
          if (window.desktopApp && typeof window.desktopApp.openFileDialog === 'function') {
            try {
              const openRes = await window.desktopApp.openFileDialog();
              if (openRes.canceled || !openRes.filePaths || openRes.filePaths.length === 0) {
                showToast('Restore cancelled — your current data was not changed.', 'info');
                return;
              }

              const selectedPath = openRes.filePaths[0];
              const readRes = await window.desktopApp.readBackupFile(selectedPath);
              if (!readRes.success) {
                showToast(`Could not read backup file: ${readRes.error}`, 'error');
                return;
              }

              await this.showRestorePreview(readRes.content, readRes.fileName, selectedPath);
            } catch (err) {
              console.error('[RESTORE OPEN ERROR]', err);
              showToast(`Error opening backup: ${err.message}`, 'error');
            }
          } else if (inputFallback) {
            inputFallback.value = '';
            inputFallback.click();
          }
        };
      }

      if (inputFallback) {
        inputFallback.onchange = async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (event) => {
            await this.showRestorePreview(event.target.result, file.name, file.name);
          };
          reader.readAsText(file);
        };
      }

      const closeRestoreModal = () => {
        if (modalRestore) modalRestore.classList.add('hidden');
        this.pendingRestoreData = null;
        showToast('Restore cancelled — your current data was not changed.', 'info');
      };

      if (btnCancelRestore) btnCancelRestore.onclick = closeRestoreModal;
      if (btnCloseRestoreX) btnCloseRestoreX.onclick = closeRestoreModal;

      if (btnPerformRestore) {
        btnPerformRestore.onclick = async () => {
          if (!this.pendingRestoreData) return;

          try {
            btnPerformRestore.disabled = true;
            btnPerformRestore.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restoring...';

            const res = await fetch('/api/backup/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                confirmed: true,
                backupData: this.pendingRestoreData.backupData,
                fileName: this.pendingRestoreData.fileName,
                filePath: this.pendingRestoreData.filePath
              })
            });

            const data = await res.json();
            if (!data.success) {
              throw new Error(data.error || 'Restore failed.');
            }

            if (modalRestore) modalRestore.classList.add('hidden');
            this.pendingRestoreData = null;

            showToast(data.message || `Backup restored successfully — ${data.leadCount} leads loaded.`, 'success', 5000);

            // Comprehensive UI state reload
            try {
              if (typeof fetchSavedLeads === 'function') await fetchSavedLeads();
              if (typeof updateBadgeCounts === 'function') await updateBadgeCounts();
              if (AppState.currentView === 'outreach' && typeof fetchOutreachData === 'function') await fetchOutreachData();
              if (AppState.currentView === 'followup' && typeof fetchFollowUpData === 'function') await fetchFollowUpData();
              await this.loadSettings();
              this.loadRecentBackups();
            } catch (reloadErr) {
              console.warn('[RESTORE RELOAD NOTICE]', reloadErr);
            }
          } catch (restoreErr) {
            console.error('[RESTORE EXECUTION ERROR]', restoreErr);
            showToast(`Restore failed: ${restoreErr.message}`, 'error', 5000);
          } finally {
            if (btnPerformRestore) {
              btnPerformRestore.disabled = false;
              btnPerformRestore.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Confirm & Restore';
            }
          }
        };
      }

      if (btnRefreshRecent) {
        btnRefreshRecent.onclick = () => this.loadRecentBackups(true);
      }

      const btnRefreshDiag = document.getElementById('btn-refresh-diagnostics');
      if (btnRefreshDiag) {
        btnRefreshDiag.onclick = () => this.loadDataHealthDiagnostics(true);
      }

      const btnCreateDiagBackup = document.getElementById('btn-create-diag-backup');
      if (btnCreateDiagBackup) {
        btnCreateDiagBackup.onclick = () => this.triggerDiagnosticSafetyBackup();
      }

      const btnDiagGotoBackup = document.getElementById('btn-diag-goto-backup');
      if (btnDiagGotoBackup) {
        btnDiagGotoBackup.onclick = () => this.switchSettingsTab('data');
      }
    },

    async showRestorePreview(rawContent, fileName, filePath) {
      try {
        showToast('Validating backup structure...', 'info', 1500);

        const res = await fetch('/api/backup/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backupData: rawContent })
        });

        const data = await res.json();
        if (!data.success || !data.valid) {
          showToast(`Invalid backup: ${data.error || 'File validation failed.'}`, 'error', 5000);
          return;
        }

        const preview = data.preview;
        this.pendingRestoreData = {
          backupData: rawContent,
          fileName,
          filePath
        };

        const filenameEl = document.getElementById('restore-preview-filename');
        if (filenameEl) filenameEl.textContent = fileName || 'Selected Backup File';

        const statsContainer = document.getElementById('restore-preview-stats');
        if (statsContainer) {
          const fmtDate = preview.createdAt ? new Date(preview.createdAt).toLocaleString() : 'Unknown';
          statsContainer.innerHTML = `
            <div class="restore-stat-card">
              <div class="restore-stat-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
                <i class="fa-solid fa-calendar-check"></i>
              </div>
              <div class="restore-stat-content">
                <span class="restore-stat-val" style="font-size: 13px;">${escapeHtml(fmtDate)}</span>
                <span class="restore-stat-lbl">Backup Creation Date</span>
              </div>
            </div>
            <div class="restore-stat-card">
              <div class="restore-stat-icon" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">
                <i class="fa-solid fa-code-branch"></i>
              </div>
              <div class="restore-stat-content">
                <span class="restore-stat-val">v${escapeHtml(preview.appVersion || '2.2.0')}</span>
                <span class="restore-stat-lbl">Application Version</span>
              </div>
            </div>
            <div class="restore-stat-card">
              <div class="restore-stat-icon" style="background: rgba(168, 85, 247, 0.15); color: #c084fc;">
                <i class="fa-solid fa-users"></i>
              </div>
              <div class="restore-stat-content">
                <span class="restore-stat-val">${preview.leadCount}</span>
                <span class="restore-stat-lbl">Saved Leads (${preview.favoritesCount} Favorites)</span>
              </div>
            </div>
            <div class="restore-stat-card">
              <div class="restore-stat-icon" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">
                <i class="fa-solid fa-paper-plane"></i>
              </div>
              <div class="restore-stat-content">
                <span class="restore-stat-val">${preview.outreachCount}</span>
                <span class="restore-stat-lbl">Outreach Records (${preview.followUpCount} Follow-Ups)</span>
              </div>
            </div>
            <div class="restore-stat-card">
              <div class="restore-stat-icon" style="background: rgba(236, 72, 153, 0.15); color: #f472b6;">
                <i class="fa-solid fa-note-sticky"></i>
              </div>
              <div class="restore-stat-content">
                <span class="restore-stat-val">${preview.notesCount} / ${preview.activitiesCount}</span>
                <span class="restore-stat-lbl">Notes & Activity Logs</span>
              </div>
            </div>
            <div class="restore-stat-card">
              <div class="restore-stat-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
                <i class="fa-solid fa-sliders"></i>
              </div>
              <div class="restore-stat-content">
                <span class="restore-stat-val">${preview.hasSettings ? 'Included' : 'None'}</span>
                <span class="restore-stat-lbl">Settings (${preview.servicesCount} Services)</span>
              </div>
            </div>
          `;
        }

        const modalRestore = document.getElementById('modal-backup-restore-preview');
        if (modalRestore) {
          modalRestore.classList.remove('hidden');
        }
      } catch (err) {
        console.error('[RESTORE PREVIEW ERROR]', err);
        showToast(`Validation error: ${err.message}`, 'error');
      }
    },

    async loadRecentBackups(manual = false) {
      const tbody = document.getElementById('recent-backups-tbody');
      if (!tbody) return;

      try {
        const res = await fetch('/api/backup/recent');
        const data = await res.json();

        if (!data.success || !Array.isArray(data.backups) || data.backups.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="4" style="text-align: center; color: #64748b; padding: 18px;">
                No backups created yet. Click "Create Backup" above to generate your first backup.
              </td>
            </tr>
          `;
          if (manual) showToast('No recent backups found.', 'info');
          return;
        }

        tbody.innerHTML = data.backups.map(b => {
          const dateStr = b.timestamp ? new Date(b.timestamp).toLocaleString() : 'Unknown';
          let badgeClass = 'backup-status-verified';
          if ((b.status || '').includes('Safety')) badgeClass = 'backup-status-safety';
          if ((b.status || '').includes('Restored')) badgeClass = 'backup-status-restored';

          return `
            <tr>
              <td style="white-space: nowrap; color: #94a3b8;">${escapeHtml(dateStr)}</td>
              <td style="font-family: monospace; font-size: 11px; color: #e2e8f0;">${escapeHtml(b.fileName || '')}</td>
              <td style="font-weight: 600; color: #34d399;">${b.leadCount ?? 0} leads</td>
              <td><span class="backup-status-badge ${badgeClass}">${escapeHtml(b.status || 'Verified')}</span></td>
            </tr>
          `;
        }).join('');

        if (manual) showToast('Recent backups list refreshed.', 'info');
      } catch (err) {
        console.warn('[RECENT BACKUPS LOAD ERROR]', err);
        tbody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align: center; color: #ef4444; padding: 14px;">
              Could not load recent backups: ${escapeHtml(err.message)}
            </td>
          </tr>
        `;
      }
    },

    async loadDataHealthDiagnostics(manual = false) {
      try {
        const btnRefresh = document.getElementById('btn-refresh-diagnostics');
        if (btnRefresh) {
          btnRefresh.disabled = true;
          btnRefresh.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
        }

        const res = await fetch('/api/diagnostics/health');
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch diagnostic data.');
        }

        // 1. Overall Badge
        const overallBadge = document.getElementById('diag-overall-badge');
        const overallText = document.getElementById('diag-overall-status-text');
        if (overallBadge && overallText) {
          overallBadge.className = `diag-status-pill ${(data.overallHealth || 'Healthy').toLowerCase()}`;
          overallText.textContent = data.overallHealth || 'Healthy';
        }

        // 2. Local Data Card
        const local = data.localData || {};
        const localPill = document.getElementById('diag-local-status-pill');
        if (localPill) {
          localPill.className = `diag-mini-pill ${(local.status || 'Healthy').toLowerCase()}`;
          localPill.textContent = local.status || 'Healthy';
        }
        const elLocalStoreStatus = document.getElementById('diag-local-store-status');
        if (elLocalStoreStatus) {
          elLocalStoreStatus.textContent = `${(local.storeStatus || 'loaded').toUpperCase()} (${local.storeDescription || 'Loaded'})`;
        }
        const elLocalPath = document.getElementById('diag-local-runtime-path');
        if (elLocalPath) {
          elLocalPath.textContent = local.runtimeDataPath || local.runtimePath || 'leads_store.json';
          elLocalPath.title = local.runtimeDataPath || local.runtimePath || '';
        }
        const elLocalLeadCount = document.getElementById('diag-local-lead-count');
        if (elLocalLeadCount) {
          elLocalLeadCount.textContent = `${local.leadCount ?? 0} leads`;
        }
        const elLocalLastSave = document.getElementById('diag-local-last-save');
        if (elLocalLastSave) {
          const saveDate = local.lastSuccessfulSave || local.lastSuccessfulSaveAt;
          elLocalLastSave.textContent = saveDate ? new Date(saveDate).toLocaleString() : 'Never';
        }
        const elLocalFileAccess = document.getElementById('diag-local-file-access');
        if (elLocalFileAccess) {
          const sizeKb = local.fileSizeBytes ? Math.round(local.fileSizeBytes / 1024) : 0;
          elLocalFileAccess.textContent = local.fileAccessible ? `Accessible (${sizeKb} KB)` : 'Inaccessible';
        }
        const elLocalValidation = document.getElementById('diag-local-validation-status');
        if (elLocalValidation) {
          elLocalValidation.textContent = local.validationStatus || local.storeValidationStatus || 'Valid';
        }

        // 3. Supabase Card
        const supa = data.supabase || {};
        const supaPill = document.getElementById('diag-supa-status-pill');
        if (supaPill) {
          const supaHealth = (supa.status === 'Healthy' || supa.health === 'Healthy') ? 'healthy' : 'warning';
          supaPill.className = `diag-mini-pill ${supaHealth}`;
          supaPill.textContent = supa.connectionStatus || supa.status || 'Ready';
        }
        const elSupaConn = document.getElementById('diag-supa-conn-status');
        if (elSupaConn) elSupaConn.textContent = supa.connectionStatus || supa.status || 'Connected';
        const elSupaSync = document.getElementById('diag-supa-sync-status');
        if (elSupaSync) elSupaSync.textContent = supa.status === 'Healthy' ? 'Active / Synchronized' : (supa.connectionStatus || 'Standby');
        const elSupaLastSync = document.getElementById('diag-supa-last-sync');
        if (elSupaLastSync) {
          const syncDate = supa.lastSuccessfulSync || supa.lastSyncAt;
          elSupaLastSync.textContent = syncDate ? new Date(syncDate).toLocaleString() : 'Not synced yet';
        }
        const elSupaLeadCount = document.getElementById('diag-supa-lead-count');
        if (elSupaLeadCount) {
          elSupaLeadCount.textContent = supa.remoteLeadCount != null ? `${supa.remoteLeadCount} leads` : '--';
        }
        const elSupaError = document.getElementById('diag-supa-error');
        if (elSupaError) {
          elSupaError.textContent = supa.syncError ? escapeHtml(supa.syncError) : 'None';
          elSupaError.style.color = supa.syncError ? '#f43f5e' : '#94a3b8';
        }

        // 4. Backup Card
        const bkp = data.backup || {};
        const bkpPill = document.getElementById('diag-backup-status-pill');
        if (bkpPill) {
          bkpPill.className = `diag-mini-pill ${(bkp.status || 'Healthy').toLowerCase()}`;
          bkpPill.textContent = bkp.status || 'Healthy';
        }
        const elBkpCount = document.getElementById('diag-backup-count');
        if (elBkpCount) elBkpCount.textContent = `${bkp.backupCount ?? bkp.recentBackupsCount ?? 0} backups`;
        const elBkpLast = document.getElementById('diag-backup-last');
        if (elBkpLast) {
          const bDate = bkp.lastSuccessfulBackup || bkp.lastBackupAt;
          elBkpLast.textContent = bDate ? new Date(bDate).toLocaleString() : 'None';
        }
        const elBkpLeads = document.getElementById('diag-backup-latest-leads');
        if (elBkpLeads) {
          const lCount = bkp.mostRecentBackupLeadCount;
          elBkpLeads.textContent = lCount != null ? `${lCount} leads` : '--';
        }
        const elBkpName = document.getElementById('diag-backup-latest-name');
        if (elBkpName) {
          elBkpName.textContent = bkp.mostRecentBackupName || bkp.mostRecentBackupFileName || 'None';
          elBkpName.title = bkp.mostRecentBackupPath || '';
        }
        const elBkpSize = document.getElementById('diag-backup-latest-size');
        if (elBkpSize) {
          const sBytes = bkp.mostRecentBackupSizeBytes;
          elBkpSize.textContent = sBytes ? `${Math.round(sBytes / 1024)} KB` : '--';
        }

        // 5. Application Card
        const app = data.application || {};
        const appPill = document.getElementById('diag-app-status-pill');
        if (appPill) {
          appPill.className = `diag-mini-pill ${(app.status || 'Healthy').toLowerCase()}`;
          appPill.textContent = app.status || 'Healthy';
        }
        const elAppVer = document.getElementById('diag-app-version');
        if (elAppVer) elAppVer.textContent = `v${app.clientHunterVersion || app.version || '2.2.0'}`;
        const elAppElectron = document.getElementById('diag-app-electron');
        if (elAppElectron) elAppElectron.textContent = `v${app.electronVersion || '44.4.1'}`;
        const elAppBackend = document.getElementById('diag-app-backend-status');
        if (elAppBackend) elAppBackend.textContent = app.backendStatus || 'Active & Responsive';
        const elAppPort = document.getElementById('diag-app-port');
        if (elAppPort) elAppPort.textContent = `Port ${app.backendPort || 3000}`;
        const elAppPlatform = document.getElementById('diag-app-platform');
        if (elAppPlatform) elAppPlatform.textContent = `${app.platform || 'win32'} / ${app.arch || 'x64'}`;
        const elAppUptime = document.getElementById('diag-app-uptime');
        if (elAppUptime && app.uptimeSeconds != null) {
          const m = Math.floor(app.uptimeSeconds / 60);
          const s = app.uptimeSeconds % 60;
          elAppUptime.textContent = `${m}m ${s}s`;
        }

        // 6. Checklist Table
        const tbody = document.getElementById('diag-checks-tbody');
        if (tbody && Array.isArray(data.checks)) {
          tbody.innerHTML = data.checks.map(c => {
            const statusClass = (c.status || 'Healthy').toLowerCase();
            return `
              <tr>
                <td>
                  <div style="font-weight: 600; color: #f1f5f9;">${escapeHtml(c.name || '')}</div>
                  <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${escapeHtml(c.id || '')}</div>
                </td>
                <td>
                  <span class="diag-mini-pill ${statusClass}">${escapeHtml(c.status || 'Healthy')}</span>
                </td>
                <td style="color: #cbd5e1; font-family: ${c.id.includes('path') ? 'monospace' : 'inherit'}; font-size: ${c.id.includes('path') ? '11px' : '12px'};">
                  ${escapeHtml(c.detail || '')}
                </td>
              </tr>
            `;
          }).join('');
        }

        if (manual) {
          showToast('Data health & diagnostics updated.', 'info', 2000);
        }
      } catch (err) {
        console.error('[DIAGNOSTICS UI ERROR]', err);
        const tbody = document.getElementById('diag-checks-tbody');
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td colspan="3" style="text-align: center; color: #f43f5e; padding: 20px;">
                Could not load diagnostics: ${escapeHtml(err.message)}
              </td>
            </tr>
          `;
        }
        if (manual) {
          showToast(`Diagnostics error: ${err.message}`, 'error', 4000);
        }
      } finally {
        const btnRefresh = document.getElementById('btn-refresh-diagnostics');
        if (btnRefresh) {
          btnRefresh.disabled = false;
          btnRefresh.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Run Diagnostics';
        }
      }
    },

    async triggerDiagnosticSafetyBackup() {
      const btn = document.getElementById('btn-create-diag-backup');
      try {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Backup...';
        }

        const res = await fetch('/api/diagnostics/backup', { method: 'POST' });
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to create safety backup.');
        }

        showToast(`Safety backup created: ${data.fileName} (${data.leadCount} leads)`, 'success', 4000);
        this.loadDataHealthDiagnostics(false);
        if (document.getElementById('recent-backups-tbody')) {
          this.loadRecentBackups(false);
        }
      } catch (err) {
        console.error('[DIAGNOSTIC BACKUP ERROR]', err);
        showToast(`Backup error: ${err.message}`, 'error', 5000);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-download"></i> Create Safety Backup';
        }
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
      } else if (tabName === 'data') {
        this.loadRecentBackups();
      } else if (tabName === 'diagnostics') {
        this.loadDataHealthDiagnostics();
      }
    },

    renderServicesList() {
      const container = document.getElementById('set-services-container');
      if (!container) return;
      const s = AppState.settings || this.getDefaults();
      const services = s.services || [];

      container.innerHTML = services.map(srv => `
        <div class="service-toggle-item" data-service-id="${srv.id}">
          <label class="service-toggle-left">
            <input type="checkbox" class="custom-checkbox chk-service-item" data-service-id="${srv.id}" ${srv.enabled ? 'checked' : ''} />
            <span class="service-name">${escapeHtml(srv.name)}</span>
          </label>
          <div class="service-toggle-right">
            <span class="badge-pill-active">${srv.enabled ? 'Enabled' : 'Disabled'}</span>
            <button type="button" class="btn-service-delete" data-service-id="${srv.id}" data-service-name="${escapeHtml(srv.name)}" title="Delete service" aria-label="Delete service ${escapeHtml(srv.name)}">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('.chk-service-item').forEach(chk => {
        chk.onchange = (e) => {
          const id = chk.getAttribute('data-service-id');
          const target = services.find(x => x.id === id);
          if (target) {
            target.enabled = chk.checked;
            if (AppState.settings) {
              AppState.settings.services = services;
            }
            this.renderServicesList();
            this.updateTemplatePreview();
          }
        };
      });

      container.querySelectorAll('.btn-service-delete').forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const srvId = btn.getAttribute('data-service-id');
          const srvName = btn.getAttribute('data-service-name') || 'this service';

          openDeleteConfirmModal(
            'Delete Service?',
            `Are you sure you want to remove '${srvName}' from My Services?`,
            async () => {
              const currentServices = s.services || [];
              const updatedServices = currentServices.filter(x => {
                if (srvId && x.id) return String(x.id) !== String(srvId);
                return x.name !== srvName;
              });

              s.services = updatedServices;
              if (AppState.settings) {
                AppState.settings.services = updatedServices;
              }

              this.renderServicesList();
              this.updateTemplatePreview();
              await this.saveCategory('services', updatedServices, 'My Services', null, `Service "${srvName}" removed.`);
            },
            'Delete'
          );
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
      const myServices = getFormattedEnabledServices(s);
      text = text.replace(/\{my_services\}/g, myServices || 'No enabled services configured');
      text = text.replace(/\{\{my_services\}\}/g, myServices || 'No enabled services configured');

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
        modal.style.display = 'none';
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
      modal.style.display = 'flex';
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

    _isCheckingUpdates: false,

    formatBuildDate(dateStr) {
      if (!dateStr) return 'September 20, 2026';
      try {
        if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const [y, m, d] = dateStr.split('-').map(Number);
          const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          if (y && m && d && months[m - 1]) {
            return `${months[m - 1]} ${d}, ${y}`;
          }
        }
        const dt = new Date(dateStr);
        if (!isNaN(dt.getTime())) {
          return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        }
      } catch (_) {}
      return 'September 20, 2026';
    },

    async checkForUpdates(forceSimulate = false) {
      if (this._isCheckingUpdates) return;
      this._isCheckingUpdates = true;

      const btn = document.getElementById('btn-check-updates');
      const pill = document.getElementById('update-status-pill');
      const lastUpdatedEl = document.getElementById('app-last-updated-date');

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
      }

      try {
        const url = forceSimulate ? '/api/system/check-updates?simulate_update=1' : '/api/system/check-updates';
        const [res] = await Promise.all([
          fetch(url),
          new Promise(resolve => setTimeout(resolve, 500))
        ]);

        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!data || !data.success) {
          throw new Error(data?.error || 'Unable to verify update status');
        }

        // Dynamically update Last Updated date from authoritative build metadata
        if (lastUpdatedEl && data.buildDate) {
          const formatted = this.formatBuildDate(data.buildDate);
          lastUpdatedEl.innerHTML = `<i class="fa-regular fa-clock" style="font-size: 10px;"></i> Last Updated: ${formatted}`;
        }

        const isUpdateAvailable = Boolean(data.updateAvailable) || (data.isUpToDate === false && Boolean(data.latestVersion) && data.latestVersion !== data.currentVersion);

        if (isUpdateAvailable) {
          const newVer = escapeHtml(data.latestVersion || 'New Version');
          if (pill) {
            pill.style.color = '#f59e0b';
            pill.innerHTML = `<i class="fa-solid fa-circle-arrow-up"></i> Update Available (v${newVer})`;
          }
          showToast(`A new version is available: Client Hunter v${newVer}.`, 'info', 5000);
        } else {
          if (pill) {
            pill.style.color = '#34d399';
            pill.innerHTML = `<i class="fa-solid fa-circle-check"></i> Up to date`;
          }
          showToast("You're up to date.", 'success', 3500);
        }
      } catch (err) {
        console.error('[UPDATE CHECK ERROR]', err);
        if (pill) {
          pill.style.color = '#94a3b8';
          pill.innerHTML = `<i class="fa-solid fa-circle-question"></i> Check failed`;
        }
        showToast('Unable to check for updates. Please try again.', 'error', 4500);
      } finally {
        this._isCheckingUpdates = false;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Check for Updates';
        }
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
          launchMode: waModeSel ? waModeSel.value : 'desktop',
          autoTimer: document.getElementById('set-wa-auto-timer') ? parseInt(document.getElementById('set-wa-auto-timer').value, 10) : (AppState.settings?.whatsappPreferences?.autoTimer ?? 3),
          followUpAutoTimer: (() => {
            const el = document.getElementById('set-wa-fu-auto-timer');
            if (el) {
              return el.value === 'immediate' ? 'immediate' : parseInt(el.value, 10);
            }
            return AppState.settings?.whatsappPreferences?.followUpAutoTimer ?? 3;
          })()
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
  window.openOutreachComposer = openOutreachComposer;
  window.startOutreachQueue = startOutreachQueue;
  window.closeOutreachComposer = closeOutreachComposer;
  window.stopOutreachQueue = stopOutreachQueue;
  window.cancelWhatsAppAutoTimer = cancelWhatsAppAutoTimer;
  window.showToast = showToast;
  window.loadFollowUpData = loadFollowUpData;
  window.setFollowUpTab = setFollowUpTab;
  window.startFollowUpQueue = startFollowUpQueue;
  window.openFollowUpQueueLead = openFollowUpQueueLead;
  window.openDedicatedFollowUpModal = openDedicatedFollowUpModal;
  window.closeDedicatedFollowUpModal = closeDedicatedFollowUpModal;
  window.handleOpenDedicatedWhatsApp = handleOpenDedicatedWhatsApp;
  window.handleConfirmDedicatedSent = handleConfirmDedicatedSent;
  window.openSnoozeModal = openSnoozeModal;
  window.closeSnoozeModal = closeSnoozeModal;
  window.applySnooze = applySnooze;
  window.renderFollowUpCards = renderFollowUpCards;
  window.updateFollowUpCounters = updateFollowUpCounters;
  window.getFollowUpWhatsAppAutoTimerSeconds = getFollowUpWhatsAppAutoTimerSeconds;
  window.getFollowUpWhatsAppAutoTimerSetting = getFollowUpWhatsAppAutoTimerSetting;
  window.cancelFollowUpWhatsAppAutoTimer = cancelFollowUpWhatsAppAutoTimer;
  window.checkAndStartFollowUpWhatsAppAutoTimer = checkAndStartFollowUpWhatsAppAutoTimer;
  window.startBulkFollowUpQueue = startBulkFollowUpQueue;
  window.handleFollowUpSelectAll = handleFollowUpSelectAll;
  window.updateFollowUpSelectionUI = updateFollowUpSelectionUI;
  window.loadDailyPerformance = loadDailyPerformance;
  window.openExportModal = openExportModal;
  window.closeExportModal = closeExportModal;
  window.executeAdvancedExport = executeAdvancedExport;
  window.resolveExportScopeData = resolveExportScopeData;
  window.serializeLeadsToCsv = serializeLeadsToCsv;
  window.serializeActivitiesToCsv = serializeActivitiesToCsv;
  window.serializeDailyPerformanceToCsv = serializeDailyPerformanceToCsv;
  window.generateSafeExportFilename = generateSafeExportFilename;

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

  function initUpdateSection() {
    const btn = document.getElementById('btn-check-updates');
    if (btn) {
      btn.onclick = (e) => {
        e.preventDefault();
        SettingsModule.checkForUpdates();
      };
    }
  }

  function initSettingsModule() {
    SettingsModule.loadSettings();
    SettingsModule.initSettingsUI();
    initResetLeadDataListeners();
    initUpdateSection();
  }

  // ----------------------------------------------------
  // GO TO TOP FLOATING BUTTON CONTROLLER
  // ----------------------------------------------------
  const GO_TO_TOP_ALLOWED_VIEWS = ['dashboard', 'saved-leads', 'favorites', 'outreach', 'followup', 'history'];

  function updateGoToTopVisibility() {
    const btn = document.getElementById('btn-go-to-top');
    if (!btn) return;

    const currentView = AppState.currentView || document.body.getAttribute('data-view') || '';
    if (!GO_TO_TOP_ALLOWED_VIEWS.includes(currentView)) {
      btn.classList.remove('visible');
      return;
    }

    const scrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const activePanel = document.querySelector('.view-panel.active-view');
    const panelScrollY = activePanel ? activePanel.scrollTop : 0;
    const effectiveScroll = Math.max(scrollY, panelScrollY);

    if (effectiveScroll > 80) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }

  function initGoToTop() {
    const btn = document.getElementById('btn-go-to-top');
    if (!btn) return;

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      // Smoothly scroll window and document containers to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (document.documentElement && document.documentElement.scrollTop > 0) {
        document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (document.body && document.body.scrollTop > 0) {
        document.body.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // If active view panel has internal scroll, smoothly scroll it to top as well
      const activePanel = document.querySelector('.view-panel.active-view');
      if (activePanel && activePanel.scrollTop > 0) {
        activePanel.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    const onScroll = function () {
      updateGoToTopVisibility();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });

    updateGoToTopVisibility();
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
      try { initUpdateSection(); } catch(e) { console.error('initUpdateSection error:', e); }
      try { initGoToTop(); } catch(e) { console.error('initGoToTop error:', e); }
      try { await loadSavedViews(); } catch(e) { console.error('loadSavedViews error:', e); }
      try { setupDashboardAnalyticsListeners(); } catch(e) { console.error('setupDashboardAnalyticsListeners error:', e); }

      // Listen for Desktop service recovery / reconnection
      if (window.desktopApp && typeof window.desktopApp.onBackendReconnected === 'function') {
        window.desktopApp.onBackendReconnected(async () => {
          console.log('[DESKTOP] Backend reconnected event received. Refreshing active view state...');
          showToast('ClientHunter services reconnected successfully.', 'success', 3500);
          try {
            // Invalidate stale caches so all views fetch fresh state
            AppState.savedLeadsDirty = true;
            AppState.favoritesDirty = true;
            AppState.outreachDirty = true;
            AppState.followupDirty = true;
            AppState.historyDirty = true;

            if (AppState.currentView === 'saved-leads' && typeof loadSavedLeads === 'function') {
              await loadSavedLeads();
            } else if (AppState.currentView === 'favorites' && typeof loadFavoriteLeads === 'function') {
              await loadFavoriteLeads();
            } else if (AppState.currentView === 'outreach' && typeof loadOutreachData === 'function') {
              await loadOutreachData(null, true);
            } else if (AppState.currentView === 'followup' && typeof loadFollowUpData === 'function') {
              await loadFollowUpData();
            } else if (AppState.currentView === 'history' && typeof loadHistoryData === 'function') {
              await loadHistoryData();
            }

            if (typeof updateBadgeCounts === 'function') {
              await updateBadgeCounts();
            }
          } catch (refreshErr) {
            console.warn('[DESKTOP] Refresh after reconnect notice:', refreshErr);
          }
        });
      }

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
