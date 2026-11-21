/* pan-site 前端逻辑（双模式）
 *
 * 模式一：静态模式（GitHub Pages 纯静态托管）
 *   - 仅提供 浏览 / 搜索 / 分类 / 详情 / 转存跳转
 *   - 所有依赖本地后端 server.py 的动态入口（添加/配置/扫码/刷新）全部隐藏
 *
 * 模式二：完整模式（本地运行 python server.py 后访问 http://127.0.0.1:8917）
 *   - 静态模式全部能力 + 添加/编辑资源统一面板（含 TMDB 搜索）、站点配置、扫码、一键刷新
 *
 * 模式由启动时探测 GET /api/health 自动决定。
 */
(function () {
  "use strict";

  var DATA_URL = "data/resources.json";
  var SITE_MODE = "static"; // static | full
  var IS_FULL = false;

  var siteNameEl = document.getElementById("siteName");
  var siteSloganEl = document.getElementById("siteSlogan");
  var siteNoticeEl = document.getElementById("siteNotice");
  var searchInput = document.getElementById("searchInput");
  var categoryTabsEl = document.getElementById("categoryTabs");
  var gridEl = document.getElementById("resourceGrid");
  var emptyEl = document.getElementById("emptyState");

  // 动态管理入口按钮
  var addBtn = document.getElementById("addBtn");
  var configBtn = document.getElementById("configBtn");
  var qrBtn = document.getElementById("qrBtn");
  var refreshBtn = document.getElementById("refreshBtn");
  var refreshLabel = document.getElementById("refreshLabel");

  var siteInfo = {};
  var categories = [];
  var resources = [];
  var keyword = "";
  var currentCategory = "全部";
  var CATEGORY_ALL = "全部";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ---------------- 模式探测 ---------------- */

  function detectMode() {
    return fetch("/api/health", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.success) {
          SITE_MODE = "full";
          IS_FULL = true;
        }
      })
      .catch(function () {
        SITE_MODE = "static";
        IS_FULL = false;
      });
  }

  function applyModeUI() {
    if (IS_FULL) return;
    // 静态模式：隐藏全部管理入口（添加 / 配置 / 扫码 / 刷新）
    [addBtn, configBtn, qrBtn, refreshBtn].forEach(function (btn) {
      if (btn) btn.hidden = true;
    });
  }

  /* ---------------- 站点信息 ---------------- */

  function renderSiteMeta() {
    if (siteInfo.name) siteNameEl.textContent = siteInfo.name;
    if (siteInfo.slogan) siteSloganEl.textContent = siteInfo.slogan;
    if (siteInfo.notice) siteNoticeEl.textContent = siteInfo.notice;
    if (siteInfo.title) document.title = siteInfo.title;
  }

  /* ---------------- 分类 / 渲染 ---------------- */

  function renderTabs() {
    var list = [CATEGORY_ALL].concat(categories || []);
    categoryTabsEl.innerHTML = list
      .map(function (cat) {
        var cls = cat === currentCategory ? "tab active" : "tab";
        return '<button type="button" class="' + cls + '" data-cat="' + escapeHtml(cat) + '">' + escapeHtml(cat) + "</button>";
      })
      .join("");
    categoryTabsEl.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        currentCategory = tab.getAttribute("data-cat");
        renderTabs();
        renderGrid();
      });
    });
  }

  function seasonAttrOf(res) {
    return res.season != null ? String(res.season) : "";
  }

  function renderCard(res) {
    var poster =
      res.poster ?
        '<div class="card-poster"><img src="' + escapeHtml(res.poster) + '" alt="' + escapeHtml(res.title) + '" loading="lazy" onerror="this.parentNode.classList.add(\'poster-fallback\');"></div>' :
        "";
    var tags = (res.tags || [])
      .map(function (t) { return '<span class="tag">' + escapeHtml(t) + "</span>"; })
      .join("");
    var linksHint =
      (res.links || []).length ?
        '<span class="badge-links">' + escapeHtml(String(res.links.length)) + " 个转存链接</span>" :
        "";

    var score =
      res.rating != null && res.rating !== "" ?
        '<span class="card-score">★ ' + escapeHtml(String(res.rating)) + "</span>" :
        "";

    var seasonAttr = seasonAttrOf(res);
    var matchBtn = "";
    var editBtn = "";
    if (IS_FULL) {
      matchBtn = res.matched
        ? '<button type="button" class="btn-match btn-rematch" data-folder="' +
          escapeHtml(res.folder_path || "") +
          '" data-season="' + escapeHtml(seasonAttr) + '" data-title="' +
          escapeHtml(res.title || "") + '" data-year="' +
          (res.year ? escapeHtml(String(res.year)) : "") + '">重新匹配</button>'
        : '<span class="badge-pending">待匹配</span>' +
          '<button type="button" class="btn-match" data-folder="' +
          escapeHtml(res.folder_path || "") + '" data-season="' + escapeHtml(seasonAttr) + '" data-title="' +
          escapeHtml(res.title || "") + '" data-year="' +
          (res.year ? escapeHtml(String(res.year)) : "") + '">匹配</button>';
      editBtn =
        '<button type="button" class="btn-edit" data-folder="' +
        escapeHtml(res.folder_path || "") +
        '" data-season="' + escapeHtml(seasonAttr) + '">编辑</button>';
    }

    return (
      '<article class="resource-card' +
      (res.poster ? " with-poster" : "") +
      '" data-id="' + escapeHtml(String(res.id != null ? res.id : "")) + '">' +
      poster +
      '<div class="card-body">' +
      '<div class="card-top">' +
      "<h3 class=\"card-title\">" + escapeHtml(res.title) + "</h3>" +
      '<div class="card-top-right">' + matchBtn + editBtn + "</div>" +
      "</div>" +
      '<div class="card-tags">' + tags + "</div>" +
      '<p class="card-desc">' + escapeHtml(res.description || "") + "</p>" +
      '<div class="card-links">' + linksHint + "</div>" +
      '<div class="card-meta">' +
      '<span class="card-category">' + escapeHtml(res.category || "") + "</span>" +
      score +
      '<span class="card-date">更新于 ' + escapeHtml(res.updated_at || "") + "</span>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function filterResources() {
    var kw = keyword.trim().toLowerCase();
    return resources
      .filter(function (res) {
        var inCategory = currentCategory === CATEGORY_ALL || res.category === currentCategory;
        if (!inCategory) return false;
        if (!kw) return true;
        var haystack = [res.title, res.description]
          .concat(res.tags || [])
          .join(" ")
          .toLowerCase();
        return haystack.indexOf(kw) !== -1;
      })
      .sort(function (a, b) {
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
  }

  function renderGrid() {
    var list = filterResources();
    if (list.length === 0) {
      gridEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    gridEl.innerHTML = list.map(renderCard).join("");
  }

  function findResource(folderPath, season) {
    for (var i = 0; i < resources.length; i++) {
      var r = resources[i];
      if (r.folder_path !== folderPath) continue;
      if (season !== undefined && r.season !== season) continue;
      return r;
    }
    return null;
  }

  function findResourceById(id) {
    if (id === null || id === undefined) return null;
    for (var i = 0; i < resources.length; i++) {
      if (String(resources[i].id) === String(id)) return resources[i];
    }
    return null;
  }

  // 卡片事件委托（编辑 / 匹配 / 详情）
  gridEl.addEventListener("click", function (evt) {
    var editBtnEl = evt.target.closest(".btn-edit");
    if (editBtnEl) {
      if (!IS_FULL) return;
      var folderPath = editBtnEl.getAttribute("data-folder") || "";
      var seasonRaw = editBtnEl.getAttribute("data-season");
      var season = seasonRaw === "" ? undefined : Number(seasonRaw);
      var res = findResource(folderPath, season);
      if (res) openResourceModal("edit", res);
      return;
    }
    var btn = evt.target.closest(".btn-match");
    if (btn) {
      if (!IS_FULL) return;
      var folderPath2 = btn.getAttribute("data-folder") || "";
      var seasonRaw2 = btn.getAttribute("data-season");
      var season2 = seasonRaw2 === "" ? undefined : Number(seasonRaw2);
      var res2 = findResource(folderPath2, season2);
      if (res2) {
        openResourceModal("edit", res2);
        if (res2.title) runResourceSearch();
      }
      return;
    }
    var card = evt.target.closest(".resource-card");
    if (!card) return;
    var rid = card.getAttribute("data-id");
    if (rid) openDetailModal(rid);
  });

  /* ---------------- 数据加载 ---------------- */

  function loadData() {
    return fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        siteInfo = data.site || siteInfo;
        categories = data.categories || [];
        resources = data.resources || [];
        fillResourceCategoryOptions();
        renderSiteMeta();
        renderTabs();
        renderGrid();
        return true;
      })
      .catch(function (err) {
        gridEl.innerHTML =
          '<div class="empty-state"><p class="empty-title">数据加载失败</p>' +
          '<p class="empty-sub">请检查 data/resources.json 是否存在且为合法 JSON（' +
          escapeHtml(err.message) +
          "）</p></div>";
        return false;
      });
  }

  /* ---------------- 一键刷新（完整模式） ---------------- */

  function setRefreshState(state, text) {
    refreshBtn.classList.toggle("loading", state === "loading");
    refreshBtn.classList.toggle("error", state === "error");
    refreshBtn.disabled = state === "loading";
    refreshLabel.textContent = text;
  }

  function handleRefresh() {
    if (!IS_FULL || refreshBtn.disabled) return;
    setRefreshState("loading", "同步中…");

    fetch("/api/refresh", { method: "POST", cache: "no-store" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) {
          setRefreshState("error", "刷新失败");
          window.alert("刷新失败：" + (data.message || data.error || "未知错误"));
          setTimeout(function () {
            setRefreshState("idle", "刷新");
          }, 2500);
          return;
        }
        return loadData().then(function () {
          setRefreshState("idle", "刷新");
          window.alert(
            "刷新完成：共 " + data.resource_count + " 条资源，刮削成功 " +
            data.scraped_ok + " / " + data.scraped_total + "，耗时 " + data.elapsed + "s"
          );
        });
      })
      .catch(function (err) {
        setRefreshState("error", "请求失败");
        window.alert("请求失败：" + err.message);
        setTimeout(function () {
          setRefreshState("idle", "刷新");
        }, 2500);
      });
  }

  refreshBtn.addEventListener("click", handleRefresh);

  // 直接以 file:// 打开时没有本地服务，禁用刷新按钮并提示
  if (window.location.protocol === "file:") {
    refreshBtn.disabled = true;
    refreshBtn.title = "请使用 python server.py 启动本地服务后，再使用一键刷新";
  }

  /* ---------------- 添加 / 编辑资源统一面板 ---------------- */

  var resourceModal = document.getElementById("resourceModal");
  var resourceModalTitle = document.getElementById("resourceModalTitle");
  var resourceFolderEl = document.getElementById("resourceFolder");
  var resourceSearchTitleEl = document.getElementById("resourceSearchTitle");
  var resourceSearchYearEl = document.getElementById("resourceSearchYear");
  var resourceSearchBtn = document.getElementById("resourceSearchBtn");
  var resourceCandidatesEl = document.getElementById("resourceCandidates");
  var resourceTitleEl = document.getElementById("resourceTitle");
  var resourceCategoryEl = document.getElementById("resourceCategory");
  var resourcePosterEl = document.getElementById("resourcePoster");
  var resourceYearEl = document.getElementById("resourceYear");
  var resourceRatingEl = document.getElementById("resourceRating");
  var resourceDescEl = document.getElementById("resourceDesc");
  var resourceCastEl = document.getElementById("resourceCast");
  var resourceTagsEl = document.getElementById("resourceTags");
  var resourceLinksEl = document.getElementById("resourceLinks");
  var resourceTipEl = document.getElementById("resourceTip");
  var resourceSaveBtn = document.getElementById("resourceSaveBtn");
  var resourceCancelBtn = document.getElementById("resourceCancelBtn");
  var resourceCloseBtn = document.getElementById("resourceModalClose");
  var resourceBackdrop = document.getElementById("resourceModalBackdrop");

  var resourceMode = "add"; // add | edit
  var currentEditFolder = "";
  var currentEditSeason = undefined;

  function fillResourceCategoryOptions() {
    if (!resourceCategoryEl) return;
    var cur = resourceCategoryEl.value;
    resourceCategoryEl.innerHTML =
      '<option value="">请选择分类</option>' +
      categories
        .map(function (c) {
          return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>";
        })
        .join("");
    if (cur) resourceCategoryEl.value = cur;
  }

  function resetResourceForm() {
    resourceSearchTitleEl.value = "";
    resourceSearchYearEl.value = "";
    resourceCandidatesEl.innerHTML = "";
    resourceTitleEl.value = "";
    resourceCategoryEl.value = "";
    resourcePosterEl.value = "";
    resourceYearEl.value = "";
    resourceRatingEl.value = "";
    resourceDescEl.value = "";
    resourceCastEl.value = "";
    resourceTagsEl.value = "";
    resourceLinksEl.value = "";
  }

  function openResourceModal(mode, record) {
    if (!IS_FULL) return;
    resetResourceForm();
    resourceMode = mode;
    if (mode === "add") {
      resourceModalTitle.textContent = "添加资源";
      resourceFolderEl.textContent = "";
      resourceTipEl.textContent =
        "搜索 TMDB 候选后点「选用」自动填充，字段可直接编辑；保存后写回 resources.json 并自动推送 GitHub Pages。";
      fillResourceCategoryOptions();
    } else {
      if (!record) return;
      currentEditFolder = record.folder_path || "";
      currentEditSeason = record.season !== undefined ? record.season : undefined;
      var label = (record.folder_path || "") + (record.season != null ? "（第 " + record.season + " 季）" : "");
      resourceFolderEl.textContent = "资源文件夹：" + label;
      resourceModalTitle.textContent = "编辑资源";
      resourceTipEl.textContent =
        "可重新搜索 TMDB 候选并「选用」覆盖，或直接修改字段后保存；保存后写回 resources.json 并自动推送 GitHub Pages。";
      resourceSearchTitleEl.value = record.title || "";
      resourceSearchYearEl.value = record.year || "";
      resourceTitleEl.value = record.title || "";
      fillResourceCategoryOptions();
      resourceCategoryEl.value = record.category || "";
      resourcePosterEl.value = record.poster || "";
      resourceYearEl.value = record.year || "";
      resourceRatingEl.value = record.rating != null ? record.rating : "";
      resourceDescEl.value = record.description || "";
      resourceCastEl.value = (record.cast || []).join(", ");
      resourceTagsEl.value = (record.tags || []).join(", ");
      resourceLinksEl.value = (record.links || [])
        .map(function (link) {
          return (link.name || "夸克网盘") + "|" + (link.url || "");
        })
        .join("\n");
    }
    resourceModal.hidden = false;
    document.body.style.overflow = "hidden";
    if (window.location.protocol !== "file:") resourceSearchTitleEl.focus();
  }

  function closeResourceModal() {
    resourceModal.hidden = true;
    document.body.style.overflow = "";
    resourceMode = "add";
    currentEditFolder = "";
    currentEditSeason = undefined;
  }

  function runResourceSearch() {
    if (!IS_FULL) return;
    var title = resourceSearchTitleEl.value.trim();
    if (!title) {
      window.alert("请先填写片名 / 剧名。");
      return;
    }
    var year = resourceSearchYearEl.value.trim();
    resourceSearchBtn.disabled = true;
    resourceSearchBtn.textContent = "搜索中…";
    resourceCandidatesEl.innerHTML = '<p class="match-loading">正在搜索 TMDB…</p>';

    var url = "/api/match/search?title=" + encodeURIComponent(title);
    if (year) url += "&year=" + encodeURIComponent(year);

    fetch(url, { cache: "no-store" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || "搜索失败");
        renderResourceCandidates(data.results || []);
      })
      .catch(function (err) {
        resourceCandidatesEl.innerHTML =
          '<p class="match-no-result">搜索失败：' + escapeHtml(err.message) +
          "（本地管理页通过 server.py 代理 TMDB；若持续失败请检查网络能否访问 api.themoviedb.org）</p>";
      })
      .finally(function () {
        resourceSearchBtn.disabled = false;
        resourceSearchBtn.textContent = "搜索 TMDB";
      });
  }

  function renderResourceCandidates(results) {
    if (!results.length) {
      resourceCandidatesEl.innerHTML =
        '<p class="match-no-result">没有找到匹配的候选，可修改标题/年份后重试，或直接编辑下方字段保存。</p>';
      return;
    }
    resourceCandidatesEl.innerHTML = results
      .map(function (c, idx) {
        var poster = "";
        if (c.poster) {
          poster =
            '<img class="match-poster" src="' + escapeHtml(c.poster) + '" alt="" loading="lazy" onerror="this.remove();">';
        }
        var typeLabel = c.media_type === "tv" ? "剧集" : "电影";
        return (
          '<div class="match-candidate">' +
          poster +
          '<div class="match-candidate-info">' +
          '<div class="match-candidate-title">' +
          escapeHtml(c.title || "") +
          (c.year ? '<span class="match-candidate-year">' + escapeHtml(String(c.year)) + "</span>" : "") +
          '<span class="match-candidate-type">' + typeLabel + "</span>" +
          "</div>" +
          '<div class="match-candidate-overview">' + escapeHtml(c.overview || "暂无简介") + "</div>" +
          "</div>" +
          '<div class="match-candidate-side">' +
          (c.rating ? '<span class="match-candidate-rating">★ ' + escapeHtml(String(c.rating)) + "</span>" : "") +
          '<button type="button" class="match-candidate-btn" data-idx="' + idx + '">选用</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    resourceCandidatesEl.querySelectorAll(".match-candidate-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var candidate = results[Number(btn.getAttribute("data-idx"))];
        if (candidate) applyResourceCandidate(candidate);
      });
    });
  }

  function applyResourceCandidate(c) {
    resourceTitleEl.value = c.title || resourceSearchTitleEl.value.trim();
    resourceYearEl.value = c.year || "";
    resourcePosterEl.value = c.poster || "";
    resourceRatingEl.value = c.rating != null ? c.rating : "";
    resourceDescEl.value = c.overview || "";
    resourceCastEl.value = (c.cast || []).join(", ");
    var cat = c.media_type === "tv" ? "剧集" : c.media_type === "movie" ? "电影" : "";
    if (cat) {
      fillResourceCategoryOptions();
      resourceCategoryEl.value = cat;
    }
    if (c.overview || c.poster) {
      resourceCandidatesEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function parseLinksText(text) {
    var links = [];
    String(text || "")
      .split(/\r?\n/)
      .forEach(function (line) {
        var idx = line.indexOf("|");
        if (idx === -1) {
          var url = line.trim();
          if (url) links.push({ name: "夸克网盘", url: url });
          return;
        }
        var name = line.slice(0, idx).trim() || "夸克网盘";
        var url = line.slice(idx + 1).trim();
        if (url) links.push({ name: name, url: url });
      });
    return links;
  }

  function saveResource() {
    if (!IS_FULL) return;
    var title = resourceTitleEl.value.trim();
    if (!title) {
      window.alert("标题不能为空。");
      return;
    }
    var payload = {
      title: title,
      category: resourceCategoryEl.value,
      poster: resourcePosterEl.value,
      year: resourceYearEl.value,
      rating: resourceRatingEl.value,
      description: resourceDescEl.value,
      cast: resourceCastEl.value
        .split(/[,，]/)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s; }),
      tags: resourceTagsEl.value
        .split(/[,，]/)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s; }),
      links: parseLinksText(resourceLinksEl.value),
      matched: true,
    };

    var url, okMsg;
    if (resourceMode === "edit") {
      payload.folder_path = currentEditFolder;
      if (currentEditSeason !== undefined) payload.season = currentEditSeason;
      url = "/api/update";
      okMsg = "已保存：";
    } else {
      url = "/api/add";
      okMsg = "已添加：";
    }

    resourceSaveBtn.disabled = true;
    resourceSaveBtn.textContent = "保存中…";

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || "保存失败");
        var extra = "";
        if (data.git && !data.git.pushed) {
          extra = "\n\n注意：自动推送 GitHub 未完成：" + (data.git.message || "未知错误") +
            "（数据已写入本地 resources.json，可稍后手动推送）";
        }
        closeResourceModal();
        window.alert(okMsg + (data.record.title || "") + extra);
        return loadData();
      })
      .catch(function (err) {
        window.alert("保存失败：" + err.message);
      })
      .finally(function () {
        resourceSaveBtn.disabled = false;
        resourceSaveBtn.textContent = "保存";
      });
  }

  addBtn.addEventListener("click", function () {
    if (IS_FULL) openResourceModal("add", null);
  });
  resourceSearchBtn.addEventListener("click", runResourceSearch);
  resourceSearchTitleEl.addEventListener("keydown", function (evt) {
    if (evt.key === "Enter") runResourceSearch();
  });
  resourceSearchYearEl.addEventListener("keydown", function (evt) {
    if (evt.key === "Enter") runResourceSearch();
  });
  resourceSaveBtn.addEventListener("click", saveResource);
  resourceCancelBtn.addEventListener("click", closeResourceModal);
  resourceCloseBtn.addEventListener("click", closeResourceModal);
  resourceBackdrop.addEventListener("click", closeResourceModal);

  /* ---------------- 资源详情面板 ---------------- */

  var detailModal = document.getElementById("detailModal");
  var detailPosterEl = document.getElementById("detailPoster");
  var detailTitleEl = document.getElementById("detailTitle");
  var detailMetaEl = document.getElementById("detailMeta");
  var detailFolderEl = document.getElementById("detailFolder");
  var detailDescEl = document.getElementById("detailDesc");
  var detailTagsEl = document.getElementById("detailTags");
  var detailLinksEl = document.getElementById("detailLinks");
  var detailEditBtn = document.getElementById("detailEditBtn");
  var detailMatchBtn = document.getElementById("detailMatchBtn");
  var detailCloseBtn = document.getElementById("detailModalClose");
  var detailBackdrop = document.getElementById("detailModalBackdrop");
  var detailTipEl = document.getElementById("detailTip");

  var currentDetailRes = null;

  function openDetailModal(id) {
    var res = findResourceById(id);
    if (!res) {
      window.alert("未找到该资源记录，请先刷新数据。");
      return;
    }
    currentDetailRes = res;

    detailTitleEl.textContent = res.title || "";
    if (res.poster) {
      detailPosterEl.src = res.poster;
      detailPosterEl.hidden = false;
    } else {
      detailPosterEl.removeAttribute("src");
      detailPosterEl.hidden = true;
    }

    var metaParts = [];
    if (res.category) metaParts.push(escapeHtml(res.category));
    if (res.year) metaParts.push(escapeHtml(String(res.year)));
    if (res.rating != null && res.rating !== "") metaParts.push("★ " + escapeHtml(String(res.rating)));
    if (res.file_count != null) metaParts.push("文件数：" + escapeHtml(String(res.file_count)));
    if (res.season != null) metaParts.push("第 " + escapeHtml(String(res.season)) + " 季");
    detailMetaEl.innerHTML = metaParts.length ? metaParts.join(" · ") : "暂无信息";

    detailFolderEl.textContent = res.folder_path
      ? "folder_path：" + res.folder_path
      : "folder_path：未设置（手动添加）";
    detailDescEl.textContent = res.description || "暂无简介";
    detailDescEl.hidden = !res.description;

    var tagsHtml = (res.tags || [])
      .map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + "</span>";
      })
      .join("");
    detailTagsEl.innerHTML = tagsHtml;
    detailTagsEl.hidden = !(res.tags || []).length;

    var links = res.links || [];
    var placeholderUsed = false;
    var linksHtml = links
      .map(function (link) {
        var url = link.url || "";
        var name = escapeHtml(link.name || "夸克网盘");
        if (!url || url.indexOf("REPLACE_WITH_SHARE_LINK") !== -1) {
          placeholderUsed = true;
          return (
            '<span class="btn-link btn-link-missing">' +
            name +
            "（分享链接待生成，请使用本地管理页刷新）</span>"
          );
        }
        return (
          '<a class="btn-link" href="' +
          escapeHtml(url) +
          '" target="_blank" rel="noopener noreferrer">' +
          name +
          " ↗</a>"
        );
      })
      .join("");
    detailLinksEl.innerHTML = linksHtml;
    detailLinksEl.hidden = !links.length;

    detailTipEl.textContent = placeholderUsed
      ? "部分链接为占位符，需在本地管理页（python server.py）运行「刷新」后自动生成夸克分享链接。"
      : "";
    detailTipEl.hidden = !placeholderUsed;

    // 静态模式隐藏编辑 / 重新匹配入口
    detailEditBtn.hidden = !IS_FULL;
    detailMatchBtn.hidden = !IS_FULL;

    detailModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDetailModal() {
    detailModal.hidden = true;
    document.body.style.overflow = "";
    currentDetailRes = null;
  }

  detailEditBtn.addEventListener("click", function () {
    if (!currentDetailRes) return;
    var res = currentDetailRes;
    closeDetailModal();
    openResourceModal("edit", res);
  });
  detailMatchBtn.addEventListener("click", function () {
    if (!currentDetailRes) return;
    var res = currentDetailRes;
    closeDetailModal();
    openResourceModal("edit", res);
    if (res.title) runResourceSearch();
  });
  detailCloseBtn.addEventListener("click", closeDetailModal);
  detailBackdrop.addEventListener("click", closeDetailModal);

  /* ---------------- 站点配置（完整模式） ---------------- */

  var configModal = document.getElementById("configModal");
  var configTmdbKeyEl = document.getElementById("configTmdbKey");
  var configQuarkDirEl = document.getElementById("configQuarkDir");
  var configAccountsEl = document.getElementById("configAccounts");
  var configAddAccountBtn = document.getElementById("configAddAccount");
  var configSaveBtn = document.getElementById("configSaveBtn");
  var configCancelBtn = document.getElementById("configCancelBtn");
  var configCloseBtn = document.getElementById("configModalClose");
  var configBackdrop = document.getElementById("configModalBackdrop");
  var configShareHeadersEl = document.getElementById("configShareHeaders");

  var configAccounts = [];

  function renderConfigAccounts() {
    if (!configAccounts.length) {
      configAccountsEl.innerHTML =
        '<p class="config-accounts-empty">尚未配置账号，点击「+ 添加账号」新增夸克 Cookie。</p>';
      return;
    }
    configAccountsEl.innerHTML = configAccounts
      .map(function (acc, idx) {
        return (
          '<div class="config-account-row">' +
          '<input type="text" class="config-acc-name" data-idx="' + idx + '" placeholder="账号备注（如：主力账号）" value="' +
          escapeHtml(acc.name || "") + '" />' +
          '<input type="password" class="config-acc-cookie" data-idx="' + idx + '" placeholder="夸克 Cookie" value="' +
          escapeHtml(acc.cookie || "") + '" />' +
          '<button type="button" class="config-acc-del" data-idx="' + idx + '" aria-label="删除账号">×</button>' +
          "</div>"
        );
      })
      .join("");

    configAccountsEl.querySelectorAll(".config-acc-name").forEach(function (input) {
      input.addEventListener("input", function () {
        var idx = Number(input.getAttribute("data-idx"));
        configAccounts[idx].name = input.value;
      });
    });
    configAccountsEl.querySelectorAll(".config-acc-cookie").forEach(function (input) {
      input.addEventListener("input", function () {
        var idx = Number(input.getAttribute("data-idx"));
        configAccounts[idx].cookie = input.value;
      });
    });
    configAccountsEl.querySelectorAll(".config-acc-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-idx"));
        configAccounts.splice(idx, 1);
        renderConfigAccounts();
      });
    });
  }

  function openConfigModal() {
    if (!IS_FULL) return;
    fetch("/api/config", { cache: "no-store" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || "读取配置失败");
        var cfg = data.config || {};
        configTmdbKeyEl.value = cfg.tmdb_api_key || "";
        configQuarkDirEl.value = cfg.quark_dir || "/媒体";
        configAccounts = (cfg.quark_accounts || []).map(function (acc) {
          return { name: acc.name || "", cookie: acc.cookie || "" };
        });
        if (!configAccounts.length && cfg.quark_cookie) {
          configAccounts.push({ name: "账号 1", cookie: cfg.quark_cookie });
        }
        configShareHeadersEl.value = JSON.stringify(cfg.share_headers || {}, null, 2);
        renderConfigAccounts();
        configModal.hidden = false;
        document.body.style.overflow = "hidden";
      })
      .catch(function (err) {
        window.alert("读取配置失败：" + err.message);
      });
  }

  function closeConfigModal() {
    configModal.hidden = true;
    document.body.style.overflow = "";
  }

  function parseShareHeaders() {
    var raw = configShareHeadersEl.value.trim();
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      throw new Error("内容不是 JSON 对象");
    } catch (e) {
      window.alert("分享鉴权头解析失败：" + e.message);
      return null;
    }
  }

  function saveConfig() {
    var shareHeaders = parseShareHeaders();
    if (shareHeaders === null) return;
    var payload = {
      tmdb_api_key: configTmdbKeyEl.value.trim(),
      quark_dir: configQuarkDirEl.value.trim() || "/媒体",
      quark_accounts: configAccounts
        .map(function (acc) {
          return { name: acc.name.trim(), cookie: acc.cookie.trim() };
        })
        .filter(function (acc) { return acc.name || acc.cookie; }),
      share_headers: shareHeaders,
    };

    configSaveBtn.disabled = true;
    configSaveBtn.textContent = "保存中…";

    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || "保存配置失败");
        closeConfigModal();
        window.alert("配置已保存，请点击「刷新」重新同步网盘资源。");
      })
      .catch(function (err) {
        window.alert("保存配置失败：" + err.message);
      })
      .finally(function () {
        configSaveBtn.disabled = false;
        configSaveBtn.textContent = "保存配置";
      });
  }

  configBtn.addEventListener("click", openConfigModal);
  configAddAccountBtn.addEventListener("click", function () {
    configAccounts.push({ name: "", cookie: "" });
    renderConfigAccounts();
  });
  configSaveBtn.addEventListener("click", saveConfig);
  configCancelBtn.addEventListener("click", closeConfigModal);
  configCloseBtn.addEventListener("click", closeConfigModal);
  configBackdrop.addEventListener("click", closeConfigModal);

  /* ---------------- 扫码登录夸克（完整模式） ---------------- */

  var qrModal = document.getElementById("qrModal");
  var qrImageEl = document.getElementById("qrImage");
  var qrStatusEl = document.getElementById("qrStatus");
  var qrHeadersEl = document.getElementById("qrHeaders");
  var qrLinksEl = document.getElementById("qrLinks");
  var qrStartBtn = document.getElementById("qrStartBtn");
  var qrCaptureBtn = document.getElementById("qrCaptureBtn");
  var qrCancelBtn = document.getElementById("qrCancelBtn");
  var qrCloseBtn = document.getElementById("qrCloseBtn");
  var qrCloseX = document.getElementById("qrModalClose");
  var qrBackdrop = document.getElementById("qrModalBackdrop");

  var qrPollTimer = null;
  var qrPolling = false;

  function qrStopPolling() {
    qrPolling = false;
    if (qrPollTimer) {
      clearTimeout(qrPollTimer);
      qrPollTimer = null;
    }
  }

  function qrSetStatus(text, cls) {
    qrStatusEl.textContent = text;
    qrStatusEl.className = "qr-status" + (cls ? " " + cls : "");
  }

  function qrShowHeaders(snap) {
    if (snap.headers && Object.keys(snap.headers).length) {
      qrHeadersEl.hidden = false;
      qrHeadersEl.innerHTML =
        '<strong>已捕获鉴权头并写回 config.json（share_headers）：</strong>' +
        '<pre class="qr-headers-pre">' +
        escapeHtml(JSON.stringify(snap.headers, null, 2)) +
        "</pre>";
    } else {
      qrHeadersEl.hidden = true;
      qrHeadersEl.innerHTML = "";
    }
    if (snap.share_url) {
      qrLinksEl.hidden = false;
      qrLinksEl.innerHTML =
        '示例分享短链：<a href="' +
        escapeHtml(snap.share_url) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(snap.share_url) +
        "</a>";
    } else {
      qrLinksEl.hidden = true;
      qrLinksEl.innerHTML = "";
    }
  }

  function qrPoll() {
    if (!qrPolling) return;
    fetch("/api/qrcode/status", { cache: "no-store" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) {
          qrSetStatus("扫码服务异常：" + (data.error || "未知错误"), "qr-error");
          qrStartBtn.hidden = false;
          qrCancelBtn.hidden = true;
          qrCaptureBtn.hidden = true;
          qrStopPolling();
          return;
        }
        var state = data.state || "idle";
        qrShowHeaders(data);
        if (state === "starting" || state === "waiting") {
          qrSetStatus("浏览器已弹出，请用夸克 App 扫码登录…" + (data.message ? "（" + data.message + "）" : ""), "qr-waiting");
          qrImageEl.src = "/api/qrcode/image?t=" + Date.now();
          qrImageEl.hidden = false;
          qrStartBtn.hidden = true;
          qrCancelBtn.hidden = false;
          qrCaptureBtn.hidden = true;
        } else if (state === "logged_in" || state === "capturing") {
          qrSetStatus(data.message || "登录成功，等待分享请求…", "qr-waiting");
          qrImageEl.hidden = true;
          qrStartBtn.hidden = true;
          qrCancelBtn.hidden = false;
          qrCaptureBtn.hidden = true;
        } else if (state === "captured") {
          qrSetStatus(data.message || "鉴权头已捕获并写回配置", "qr-ok");
          qrImageEl.hidden = true;
          qrStartBtn.hidden = true;
          qrCancelBtn.hidden = false;
          qrCaptureBtn.hidden = true;
          qrStopPolling();
        } else if (state === "failed") {
          qrSetStatus(data.message || "失败：" + (data.error || ""), "qr-error");
          qrImageEl.hidden = true;
          qrStartBtn.hidden = true;
          qrCancelBtn.hidden = false;
          qrCaptureBtn.hidden = false;
          qrStopPolling();
        } else if (state === "cancelled") {
          qrSetStatus("会话已结束，浏览器已关闭。", "qr-idle");
          qrImageEl.hidden = true;
          qrStartBtn.hidden = false;
          qrCancelBtn.hidden = true;
          qrCaptureBtn.hidden = true;
          qrStopPolling();
        } else {
          qrSetStatus("尚未开始。点击「开始扫码」会弹出浏览器窗口。", "qr-idle");
          qrImageEl.hidden = true;
          qrStartBtn.hidden = false;
          qrCancelBtn.hidden = true;
          qrCaptureBtn.hidden = true;
          qrStopPolling();
        }
      })
      .catch(function (err) {
        qrSetStatus("轮询失败：" + err.message, "qr-error");
      })
      .finally(function () {
        if (qrPolling) qrPollTimer = setTimeout(qrPoll, 2000);
      });
  }

  function qrStartPolling() {
    qrPolling = true;
    qrPoll();
  }

  function openQrModal() {
    if (!IS_FULL) return;
    qrStopPolling();
    qrImageEl.hidden = true;
    qrHeadersEl.hidden = true;
    qrLinksEl.hidden = true;
    qrSetStatus("尚未开始。点击「开始扫码」会弹出浏览器窗口。", "qr-idle");
    qrStartBtn.hidden = false;
    qrCancelBtn.hidden = true;
    qrCaptureBtn.hidden = true;
    qrModal.hidden = false;
    document.body.style.overflow = "hidden";
    fetch("/api/qrcode/status", { cache: "no-store" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.success && data.state && data.state !== "idle") {
          qrStartPolling();
        }
      })
      .catch(function () {});
  }

  function closeQrModal() {
    qrModal.hidden = true;
    document.body.style.overflow = "";
    qrStopPolling();
  }

  function qrStartSession() {
    qrStartBtn.disabled = true;
    qrStartBtn.textContent = "启动中…";
    fetch("/api/qrcode/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) {
          qrSetStatus("启动失败：" + (data.error || "未知错误"), "qr-error");
          return;
        }
        qrSetStatus("正在启动浏览器…", "qr-waiting");
        qrStartPolling();
      })
      .catch(function (err) {
        qrSetStatus("启动失败：" + err.message, "qr-error");
      })
      .finally(function () {
        qrStartBtn.disabled = false;
        qrStartBtn.textContent = "开始扫码";
      });
  }

  function qrCaptureNow() {
    qrCaptureBtn.disabled = true;
    qrCaptureBtn.textContent = "等待中…";
    fetch("/api/qrcode/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) {
          qrSetStatus("无法开始捕获：" + (data.error || "未知错误"), "qr-error");
          return;
        }
        qrSetStatus("已进入捕获阶段，请在浏览器中任选文件夹点「分享」…", "qr-waiting");
        qrCaptureBtn.hidden = true;
        qrStartPolling();
      })
      .catch(function (err) {
        qrSetStatus("无法开始捕获：" + err.message, "qr-error");
      })
      .finally(function () {
        qrCaptureBtn.disabled = false;
        qrCaptureBtn.textContent = "开始捕获";
      });
  }

  function qrEndSession() {
    qrStopPolling();
    qrCancelBtn.disabled = true;
    fetch("/api/qrcode/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        qrSetStatus(
          data.success ? "已请求结束会话，浏览器正在关闭…" : "结束会话失败：" + (data.error || ""),
          data.success ? "qr-idle" : "qr-error"
        );
        qrImageEl.hidden = true;
        qrStartBtn.hidden = false;
        qrCancelBtn.hidden = true;
        qrCaptureBtn.hidden = true;
      })
      .catch(function (err) {
        qrSetStatus("结束会话失败：" + err.message, "qr-error");
      })
      .finally(function () {
        qrCancelBtn.disabled = false;
      });
  }

  qrBtn.addEventListener("click", openQrModal);
  qrStartBtn.addEventListener("click", qrStartSession);
  qrCaptureBtn.addEventListener("click", qrCaptureNow);
  qrCancelBtn.addEventListener("click", qrEndSession);
  qrCloseBtn.addEventListener("click", closeQrModal);
  qrCloseX.addEventListener("click", closeQrModal);
  qrBackdrop.addEventListener("click", closeQrModal);

  // 直接以 file:// 打开时没有本地服务，禁用扫码按钮并提示
  if (window.location.protocol === "file:") {
    qrBtn.disabled = true;
    qrBtn.title = "请使用 python server.py 启动本地服务后，再使用扫码登录";
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    detectMode().then(function () {
      applyModeUI();
      loadData();
    });
  }

  // 搜索防抖
  var debounceTimer = null;
  searchInput.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      keyword = searchInput.value;
      renderGrid();
    }, 200);
  });

  init();
})();
