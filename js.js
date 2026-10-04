(() => {
  "use strict";

  const SUPABASE_URL = "https://wfxuxrvygyzonkflpwoq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_e2h4t8AvCobzftt36UrDbw_NJGq8qlJ";
  const BUCKET = "dfl-projects";
  const TABLE = "dfl_project_photos";

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const $ = (selector) => document.querySelector(selector);
  const loginView = $("#loginView");
  const appView = $("#appView");
  const loginForm = $("#loginForm");
  const loginButton = $("#loginButton");
  const loginError = $("#loginError");
  const fileInput = $("#fileInput");
  const photoGrid = $("#photoGrid");
  const photoCount = $("#photoCount");
  const loadingState = $("#loadingState");
  const emptyState = $("#emptyState");
  const desktopPreview = $("#desktopPreview");
  const mobilePreview = $("#mobilePreview");
  const signedInEmail = $("#signedInEmail");
  const deleteModal = $("#deleteModal");
  const featuredModal = $("#featuredModal");
  const pairModal = $("#pairModal");
  const pairChoices = $("#pairChoices");
  const savePair = $("#savePair");
  const featuredChoices = $("#featuredChoices");
  const saveFeatured = $("#saveFeatured");

  let photos = [];
  let sortable = null;
  let pendingDelete = null;
  let pendingFeaturedPhoto = null;
  let pendingPairPhoto = null;
  let selectedPairId = null;
  let selectedFeaturedId = null;
  let toastTimer = null;

  function toast(message, type = "ok") {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("error", type === "error");
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function setBusy(button, busy, normalText) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.original = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Working…';
    } else if (button.dataset.original) {
      button.innerHTML = button.dataset.original;
      delete button.dataset.original;
    } else if (normalText) {
      button.textContent = normalText;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function publicUrl(path) {
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function checkAdmin(user) {
    const { data, error } = await client
      .from("dfl_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  }

  async function enterApp(session) {
    const user = session?.user;
    if (!user) return showLogin();

    try {
      const allowed = await checkAdmin(user);
      if (!allowed) {
        await client.auth.signOut();
        showLogin("This account is signed in, but it is not a Desert Forest admin.");
        return;
      }
    } catch (error) {
      console.error(error);
      showLogin("Admin access is not set up yet. Run the SQL below first.");
      return;
    }

    signedInEmail.textContent = user.email || "Admin";
    loginView.hidden = true;
    appView.hidden = false;
    await loadPhotos();
  }

  function showLogin(message = "") {
    appView.hidden = true;
    loginView.hidden = false;
    if (message) {
      loginError.hidden = false;
      loginError.textContent = message;
    } else {
      loginError.hidden = true;
      loginError.textContent = "";
    }
  }

  async function loadPhotos() {
    loadingState.hidden = false;
    emptyState.hidden = true;
    photoGrid.innerHTML = "";

    const { data, error } = await client
      .from(TABLE)
      .select("id,storage_path,label,sort_order,paired_photo_id,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    loadingState.hidden = true;

    if (error) {
      console.error(error);
      toast("Could not load photos.", "error");
      photoGrid.innerHTML = '<div class="state-box" style="grid-column:1/-1"><strong>Could not load project photos.</strong><span>Make sure you ran the Supabase SQL.</span></div>';
      return;
    }

    photos = data || [];

    // Keep linked Before/After photos beside each other when loading.
    const visited = new Set();
    const normalized = [];

    for (const photo of photos) {
      if (visited.has(photo.id)) continue;

      visited.add(photo.id);
      const partner = photo.paired_photo_id
        ? photos.find((item) => item.id === photo.paired_photo_id)
        : null;

      if (partner && !visited.has(partner.id)) {
        visited.add(partner.id);

        if (photo.label === "before") normalized.push(photo, partner);
        else if (partner.label === "before") normalized.push(partner, photo);
        else normalized.push(photo, partner);
      } else {
        normalized.push(photo);
      }
    }

    photos = normalized.map((photo, index) => ({
      ...photo,
      sort_order: index + 1
    }));

    render();
  }

  function render() {
    photoCount.textContent = photos.length;
    emptyState.hidden = photos.length !== 0;
    photoGrid.innerHTML = photos.map((photo, index) => photoCard(photo, index)).join("");
    renderPreviews();
    wireCards();
    initSortable();
  }


  function pairedDescription(photo) {
    if (!photo?.paired_photo_id) return "None";
    const paired = photos.find((item) => item.id === photo.paired_photo_id);
    if (!paired) return "Linked photo";
    const pairIndex = photos.findIndex((item) => item.id === paired.id);
    const pairLabel = paired.label === "before" ? "Before" : paired.label === "after" ? "After" : "—";
    return `${pairLabel} • Position ${pairIndex + 1}`;
  }

  function photoCard(photo, index) {
    const label = photo.label === "before" ? "Before" : photo.label === "after" ? "After" : "—";
    const src = publicUrl(photo.storage_path);

    return `
      <article class="photo-card" data-id="${escapeHtml(photo.id)}">
        <div class="photo-image-wrap">
          <img src="${escapeHtml(src)}" alt="Project photo ${index + 1}" loading="lazy">
          <span class="order-badge">${index + 1}</span>
          ${photo.label === "before" || photo.label === "after" ? `<span class="label-badge">${label}</span>` : ""}
          <button class="drag-handle" type="button" title="Drag to reorder" aria-label="Drag photo ${index + 1} to reorder">
            <i class="fa-solid fa-grip-vertical"></i>
          </button>
          <button
            class="home-star ${index < 6 ? "featured" : ""}"
            type="button"
            data-featured
            title="${index < 6 ? "Currently on homepage" : "Put this photo on homepage"}"
            aria-label="${index < 6 ? `Photo ${index + 1} is currently on the homepage` : `Put photo ${index + 1} on the homepage`}"
          >
            <i class="${index < 6 ? "fa-solid" : "fa-regular"} fa-star"></i>
          </button>
        </div>
        <div class="photo-body">
          <div class="label-toggle" aria-label="Photo label">
            <button type="button" data-label="before" class="${photo.label === "before" ? "active" : ""}">Before</button>
            <button type="button" data-label="after" class="${photo.label === "after" ? "active" : ""}">After</button>
            <button type="button" data-label="none" class="no-label-option ${photo.label !== "before" && photo.label !== "after" ? "active" : ""}" title="No label" aria-label="No Before or After label">-</button>
          </div>
          <div class="card-actions">
            <span class="card-position">Position ${index + 1}</span>
            <div style="display:flex;gap:7px;align-items:center">
              <button
                class="pair-button ${photo.paired_photo_id ? "paired" : ""} ${photo.label !== "before" && photo.label !== "after" ? "disabled-pair" : ""}"
                type="button"
                data-pair
                title="${photo.label !== "before" && photo.label !== "after" ? "Choose Before or After before pairing" : photo.paired_photo_id ? "Change paired photo" : "Pair before and after"}"
              >
                <i class="fa-solid fa-link"></i>
                ${photo.paired_photo_id ? "Change Pair" : "Pair"}
              </button>
              ${photo.paired_photo_id ? `
                <button
                  class="unpair-button"
                  type="button"
                  data-unpair
                  title="Unpair these photos"
                  aria-label="Unpair photo ${index + 1}"
                >
                  <i class="fa-solid fa-link-slash"></i>
                  Unpair
                </button>
              ` : ""}
              <button class="delete-button" type="button" data-delete title="Delete photo" aria-label="Delete photo ${index + 1}">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            </div>
          </div>
          ${photo.paired_photo_id ? `
            <div class="pair-meta">
              <strong>Paired:</strong> ${pairedDescription(photo)}
            </div>
          ` : ""}
        </div>
      </article>
    `;
  }

  function renderPreviews() {
    desktopPreview.innerHTML = previewItems(5);
    mobilePreview.innerHTML = previewItems(6);
  }

  function previewItems(limit) {
    const items = [];
    for (let i = 0; i < limit; i++) {
      const photo = photos[i];
      if (!photo) {
        items.push(`<div class="preview-placeholder">${i + 1}</div>`);
        continue;
      }
      const label = photo.label === "before" ? "Before" : photo.label === "after" ? "After" : "";
      items.push(`
        <div class="preview-photo">
          <img src="${escapeHtml(publicUrl(photo.storage_path))}" alt="">
          ${label ? `<span>${label}</span>` : ""}
        </div>
      `);
    }
    return items.join("");
  }



  function openPairModal(photo) {
    if (photo.label !== "before" && photo.label !== "after") {
      toast("Choose Before or After before pairing this photo.", "error");
      return;
    }

    pendingPairPhoto = photo;
    selectedPairId = photo.paired_photo_id || null;

    const targetLabel = photo.label === "before" ? "after" : "before";
    $("#pairModalCopy").textContent =
      `This is marked ${photo.label.toUpperCase()}. Choose a ${targetLabel.toUpperCase()} photo to pair with it.`;

    const choices = photos.filter((item) =>
      item.id !== photo.id &&
      item.label === targetLabel
    );

    pairChoices.innerHTML = choices.length
      ? choices.map((item) => {
          const index = photos.findIndex((x) => x.id === item.id);
          const selected = selectedPairId === item.id;
          return `
            <button
              type="button"
              class="featured-choice ${selected ? "selected" : ""}"
              data-pair-id="${escapeHtml(item.id)}"
              aria-label="Pair with ${targetLabel} photo ${index + 1}"
            >
              <img src="${escapeHtml(publicUrl(item.storage_path))}" alt="${targetLabel} photo ${index + 1}">
              <span>${index + 1}</span>
              <em class="pair-choice-type">${targetLabel.toUpperCase()}</em>
              <b class="featured-check"><i class="fa-solid fa-check"></i></b>
            </button>
          `;
        }).join("")
      : `<div class="featured-empty">No ${targetLabel} photos are available yet.</div>`;

    pairChoices.querySelectorAll("[data-pair-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedPairId = button.dataset.pairId;
        pairChoices.querySelectorAll(".featured-choice").forEach((choice) => {
          choice.classList.toggle("selected", choice === button);
        });
        savePair.disabled = false;
      });
    });

    savePair.disabled = !selectedPairId;
    pairModal.hidden = false;
  }

  function closePairModal() {
    pendingPairPhoto = null;
    selectedPairId = null;
    savePair.disabled = true;
    pairModal.hidden = true;
  }


  function orderPairBeforeAfter(firstId, secondId) {
    const first = photos.find((item) => item.id === firstId);
    const second = photos.find((item) => item.id === secondId);
    if (!first || !second) return;

    if (!["before", "after"].includes(first.label) || !["before", "after"].includes(second.label)) return;

    const before = first.label === "before" ? first : second;
    const after = before.id === first.id ? second : first;

    const firstIndex = photos.findIndex((item) => item.id === first.id);
    const secondIndex = photos.findIndex((item) => item.id === second.id);
    const insertAt = Math.max(0, Math.min(firstIndex, secondIndex));

    const remaining = photos.filter(
      (item) => item.id !== first.id && item.id !== second.id
    );

    remaining.splice(insertAt, 0, before, after);

    photos = remaining.map((item, index) => ({
      ...item,
      sort_order: index + 1
    }));
  }

  async function unpairPhoto(photo) {
    if (!photo?.paired_photo_id) return;

    const otherId = photo.paired_photo_id;

    const { error: firstError } = await client
      .from(TABLE)
      .update({ paired_photo_id: null })
      .eq("id", photo.id);
    if (firstError) throw firstError;

    const { error: secondError } = await client
      .from(TABLE)
      .update({ paired_photo_id: null })
      .eq("id", otherId)
      .eq("paired_photo_id", photo.id);
    if (secondError) throw secondError;
  }

  function openFeaturedModal(photo) {
    const index = photos.findIndex((item) => item.id === photo.id);

    if (index >= 0 && index < 6) {
      toast(`This photo is already homepage slot ${index + 1}.`);
      return;
    }

    pendingFeaturedPhoto = photo;
    selectedFeaturedId = null;
    saveFeatured.disabled = true;

    const currentSix = photos.slice(0, 6);
    featuredChoices.innerHTML = currentSix.length
      ? currentSix.map((item, slot) => `
          <button
            type="button"
            class="featured-choice"
            data-replace-id="${escapeHtml(item.id)}"
            aria-label="Replace homepage photo ${slot + 1}"
          >
            <img src="${escapeHtml(publicUrl(item.storage_path))}" alt="Current homepage photo ${slot + 1}">
            <span>${slot + 1}</span>
            <b class="featured-check"><i class="fa-solid fa-check"></i></b>
          </button>
        `).join("")
      : '<div class="featured-empty">There are no current homepage photos to replace yet.</div>';

    featuredChoices.querySelectorAll("[data-replace-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedFeaturedId = button.dataset.replaceId;
        featuredChoices.querySelectorAll(".featured-choice").forEach((choice) => {
          choice.classList.toggle("selected", choice === button);
        });
        saveFeatured.disabled = false;
      });
    });

    featuredModal.hidden = false;
  }

  function closeFeaturedModal() {
    pendingFeaturedPhoto = null;
    selectedFeaturedId = null;
    saveFeatured.disabled = true;
    featuredModal.hidden = true;
  }

  async function persistPhotoOrder(order) {
    for (let i = 0; i < order.length; i++) {
      const { error } = await client
        .from(TABLE)
        .update({ sort_order: i + 1 })
        .eq("id", order[i].id);
      if (error) throw error;
    }
  }

  function wireCards() {
    photoGrid.querySelectorAll("[data-unpair]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();

        const card = button.closest(".photo-card");
        const photo = photos.find((item) => item.id === card.dataset.id);
        if (!photo?.paired_photo_id) return;

        const partner = photos.find((item) => item.id === photo.paired_photo_id);
        const confirmed = window.confirm(
          `Unpair this ${photo.label.toUpperCase()} photo${partner ? ` from its ${partner.label.toUpperCase()} photo` : ""}?`
        );
        if (!confirmed) return;

        try {
          await unpairPhoto(photo);

          const partnerId = photo.paired_photo_id;
          photo.paired_photo_id = null;
          if (partnerId) {
            const localPartner = photos.find((item) => item.id === partnerId);
            if (localPartner) localPartner.paired_photo_id = null;
          }

          render();
          toast("Photos unpaired.");
        } catch (error) {
          console.error(error);
          toast("Could not unpair the photos.", "error");
        }
      });
    });

    photoGrid.querySelectorAll(".photo-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (
          event.target.closest("button") ||
          event.target.closest(".label-toggle")
        ) return;

        const id = card.dataset.id;
        const alreadySelected = card.classList.contains("pair-selected");

        if (alreadySelected) clearPairSelection();
        else highlightPair(id, false);
      });
    });

    photoGrid.querySelectorAll("[data-pair]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".photo-card");
        const photo = photos.find((item) => item.id === card.dataset.id);
        if (!photo) return;

        openPairModal(photo);
      });
    });

    photoGrid.querySelectorAll("[data-featured]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest(".photo-card");
        const photo = photos.find((item) => item.id === card.dataset.id);
        if (photo) openFeaturedModal(photo);
      });
    });

    photoGrid.querySelectorAll("[data-label]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".photo-card");
        const id = card.dataset.id;
        const label = button.dataset.label;
        const photo = photos.find((item) => item.id === id);
        if (!photo || photo.label === label) return;

        const oldLabel = photo.label;

        if (label === "none" && photo.paired_photo_id) {
          try {
            const partnerId = photo.paired_photo_id;
            await unpairPhoto(photo);
            photo.paired_photo_id = null;
            const partner = photos.find((item) => item.id === partnerId);
            if (partner) partner.paired_photo_id = null;
          } catch (unpairError) {
            console.error(unpairError);
            toast("Could not remove the existing pair.", "error");
            return;
          }
        }

        photo.label = label;
        render();

        const { error } = await client.from(TABLE).update({ label }).eq("id", id);
        if (error) {
          console.error(error);
          photo.label = oldLabel;
          render();
          toast("Could not save the label.", "error");
          return;
        }

        if (photo.paired_photo_id) {
          orderPairBeforeAfter(photo.id, photo.paired_photo_id);
          try {
            await persistPhotoOrder(photos);
          } catch (orderError) {
            console.error(orderError);
          }
          render();
        }

        toast(label === "none" ? "Photo label removed." : `Marked as ${label}.`);
      });
    });

    photoGrid.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest(".photo-card");
        pendingDelete = photos.find((item) => item.id === card.dataset.id) || null;
        if (pendingDelete) deleteModal.hidden = false;
      });
    });
  }


  function getPairId(photo) {
    return photo?.paired_photo_id || null;
  }

  function getPairMembers(photoId) {
    const photo = photos.find((item) => item.id === photoId);
    if (!photo) return [];

    const ids = [photo.id];
    if (photo.paired_photo_id) ids.push(photo.paired_photo_id);

    return ids
      .map((id) => photos.find((item) => item.id === id))
      .filter(Boolean);
  }

  function clearPairSelection() {
    photoGrid.querySelectorAll(".photo-card").forEach((card) => {
      card.classList.remove("pair-selected", "pair-dragging");
    });
  }

  function highlightPair(photoId, dragging = false) {
    clearPairSelection();
    const members = getPairMembers(photoId);

    members.forEach((member) => {
      const card = photoGrid.querySelector(`.photo-card[data-id="${CSS.escape(member.id)}"]`);
      if (!card) return;
      card.classList.add("pair-selected");
      if (dragging) card.classList.add("pair-dragging");
    });
  }

  function makePairsAdjacent(order, movedId) {
    const moved = order.find((item) => item.id === movedId);
    if (!moved?.paired_photo_id) return order;

    const partnerIndex = order.findIndex((item) => item.id === moved.paired_photo_id);
    const movedIndex = order.findIndex((item) => item.id === moved.id);

    if (partnerIndex < 0 || movedIndex < 0) return order;

    const partner = order[partnerIndex];
    let remaining = order.filter(
      (item) => item.id !== moved.id && item.id !== partner.id
    );

    // Keep BEFORE first and AFTER second inside a pair when possible.
    const pairBlock =
      moved.label === "before"
        ? [moved, partner]
        : partner.label === "before"
          ? [partner, moved]
          : [moved, partner];

    // Determine target insertion point based on where the dragged card landed.
    const originalVisibleOrder = [...photoGrid.querySelectorAll(".photo-card")]
      .map((el) => el.dataset.id)
      .filter((id) => id !== partner.id);

    let insertAt = originalVisibleOrder.indexOf(moved.id);
    if (insertAt < 0) insertAt = remaining.length;
    insertAt = Math.min(insertAt, remaining.length);

    remaining.splice(insertAt, 0, ...pairBlock);
    return remaining;
  }

  function initSortable() {
    if (sortable) sortable.destroy();

    sortable = new Sortable(photoGrid, {
      animation: 180,
      handle: ".drag-handle",
      ghostClass: "sortable-ghost",
      forceFallback: true,
      fallbackOnBody: true,

      onChoose: (event) => {
        const id = event.item?.dataset?.id;
        if (id) highlightPair(id, false);
      },

      onStart: (event) => {
        const id = event.item?.dataset?.id;
        if (id) highlightPair(id, true);
      },

      onUnchoose: () => {
        clearPairSelection();
      },

      onEnd: async (event) => {
        const movedId = event.item?.dataset?.id;

        const ids = [...photoGrid.querySelectorAll(".photo-card")]
          .map((el) => el.dataset.id);

        const byId = new Map(photos.map((photo) => [photo.id, photo]));
        let reordered = ids.map((id) => byId.get(id)).filter(Boolean);

        if (movedId) {
          reordered = makePairsAdjacent(reordered, movedId);
        }

        photos = reordered.map((photo, index) => ({
          ...photo,
          sort_order: index + 1
        }));

        render();

        try {
          await persistPhotoOrder(photos);
          toast(
            getPairMembers(movedId).length > 1
              ? "Paired photos moved together."
              : "Photo order saved."
          );
        } catch (error) {
          console.error(error);
          toast("Could not save the new order.", "error");
          await loadPhotos();
        }
      }
    });
  }

  async function saveNewOrder() {
    const ids = [...photoGrid.querySelectorAll(".photo-card")].map((el) => el.dataset.id);
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const reordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const previous = photos.slice();

    photos = reordered.map((photo, index) => ({ ...photo, sort_order: index + 1 }));
    render();

    try {
      await persistPhotoOrder(photos);
      toast("Photo order saved.");
    } catch (error) {
      console.error(error);
      photos = previous;
      render();
      toast("Could not save the new order.", "error");
    }
  }

  function safeFilename(name) {
    const dot = name.lastIndexOf(".");
    const extension = dot >= 0 ? name.slice(dot).toLowerCase() : "";
    const base = (dot >= 0 ? name.slice(0, dot) : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "photo";
    return `${base}${extension}`;
  }

  async function uploadFiles(files) {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
    const valid = files.filter((file) => allowed.has(file.type) && file.size <= 10 * 1024 * 1024);

    if (!valid.length) {
      toast("Choose JPG, PNG, WEBP, or AVIF images under 10 MB.", "error");
      return;
    }

    const label = document.querySelector(".upload-button");
    label.style.pointerEvents = "none";
    label.style.opacity = ".6";

    let nextOrder = photos.length + 1;
    let uploaded = 0;

    try {
      for (const file of valid) {
        const storagePath = `projects/${crypto.randomUUID()}-${safeFilename(file.name)}`;

        const { error: uploadError } = await client.storage
          .from(BUCKET)
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type
          });

        if (uploadError) throw uploadError;

        const { error: insertError } = await client
          .from(TABLE)
          .insert({
            storage_path: storagePath,
            label: "none",
            sort_order: nextOrder
          });

        if (insertError) {
          await client.storage.from(BUCKET).remove([storagePath]);
          throw insertError;
        }

        nextOrder += 1;
        uploaded += 1;
      }

      await loadPhotos();
      toast(`${uploaded} photo${uploaded === 1 ? "" : "s"} uploaded.`);
    } catch (error) {
      console.error(error);
      toast(error.message || "Upload failed.", "error");
      await loadPhotos();
    } finally {
      label.style.pointerEvents = "";
      label.style.opacity = "";
      fileInput.value = "";
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    setBusy(loginButton, true);

    const email = $("#email").value.trim();
    const password = $("#password").value;

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    setBusy(loginButton, false);

    if (error) {
      loginError.hidden = false;
      loginError.textContent = "Could not sign in. Check your email and password.";
      return;
    }

    await enterApp(data.session);
  });

  $("#togglePassword").addEventListener("click", () => {
    const input = $("#password");
    const icon = $("#togglePassword i");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    icon.className = showing ? "fa-regular fa-eye" : "fa-regular fa-eye-slash";
  });

  $("#signOutButton").addEventListener("click", async () => {
    await client.auth.signOut();
    photos = [];
    showLogin();
  });

  fileInput.addEventListener("change", () => uploadFiles([...fileInput.files]));



  $("#cancelPair").addEventListener("click", closePairModal);

  savePair.addEventListener("click", async () => {
    if (!pendingPairPhoto || !selectedPairId) return;

    const photo = pendingPairPhoto;
    const other = photos.find((item) => item.id === selectedPairId);
    if (!other) return;

    if (photo.label === other.label) {
      toast("Before photos can only pair with After photos.", "error");
      return;
    }

    setBusy(savePair, true);

    try {
      // Clear previous pair on this photo, if any.
      if (photo.paired_photo_id && photo.paired_photo_id !== other.id) {
        await unpairPhoto(photo);
      }

      // Clear previous pair on the selected counterpart, if any.
      if (other.paired_photo_id && other.paired_photo_id !== photo.id) {
        await unpairPhoto(other);
      }

      const { error: firstError } = await client
        .from(TABLE)
        .update({ paired_photo_id: other.id })
        .eq("id", photo.id);
      if (firstError) throw firstError;

      const { error: secondError } = await client
        .from(TABLE)
        .update({ paired_photo_id: photo.id })
        .eq("id", other.id);
      if (secondError) throw secondError;

      // Update local pair state, then force BEFORE first and AFTER second.
      photo.paired_photo_id = other.id;
      other.paired_photo_id = photo.id;
      orderPairBeforeAfter(photo.id, other.id);
      await persistPhotoOrder(photos);

      closePairModal();
      render();
      toast("Paired — Before is first, After is second.");
    } catch (error) {
      console.error(error);
      toast("Could not save the pair.", "error");
    } finally {
      setBusy(savePair, false);
    }
  });

  pairModal.addEventListener("click", (event) => {
    if (event.target === pairModal) closePairModal();
  });

  $("#cancelFeatured").addEventListener("click", closeFeaturedModal);

  saveFeatured.addEventListener("click", async () => {
    if (!pendingFeaturedPhoto || !selectedFeaturedId) return;

    const incomingIndex = photos.findIndex((item) => item.id === pendingFeaturedPhoto.id);
    const replaceIndex = photos.findIndex((item) => item.id === selectedFeaturedId);
    if (incomingIndex < 0 || replaceIndex < 0 || replaceIndex >= 6) return;

    const previous = photos.map((item) => ({ ...item }));
    const incoming = photos[incomingIndex];
    const outgoing = photos[replaceIndex];

    photos[replaceIndex] = incoming;
    photos[incomingIndex] = outgoing;
    photos = photos.map((item, index) => ({ ...item, sort_order: index + 1 }));

    setBusy(saveFeatured, true);
    try {
      await persistPhotoOrder(photos);
      closeFeaturedModal();
      render();
      toast(`Homepage photo ${replaceIndex + 1} switched.`);
    } catch (error) {
      console.error(error);
      photos = previous;
      render();
      toast("Could not switch the homepage photo.", "error");
    } finally {
      setBusy(saveFeatured, false);
    }
  });

  featuredModal.addEventListener("click", (event) => {
    if (event.target === featuredModal) closeFeaturedModal();
  });

  $("#cancelDelete").addEventListener("click", () => {
    pendingDelete = null;
    deleteModal.hidden = true;
  });

  $("#confirmDelete").addEventListener("click", async () => {
    if (!pendingDelete) return;
    const button = $("#confirmDelete");
    setBusy(button, true);

    const target = pendingDelete;
    const { error: rowError } = await client.from(TABLE).delete().eq("id", target.id);

    if (rowError) {
      console.error(rowError);
      setBusy(button, false);
      toast("Could not delete the photo.", "error");
      return;
    }

    const { error: storageError } = await client.storage.from(BUCKET).remove([target.storage_path]);
    if (storageError) console.warn("Photo row deleted, but storage cleanup failed:", storageError);

    pendingDelete = null;
    deleteModal.hidden = true;
    setBusy(button, false);
    await loadPhotos();
    await saveNewOrder();
    toast("Photo deleted.");
  });

  deleteModal.addEventListener("click", (event) => {
    if (event.target === deleteModal) {
      pendingDelete = null;
      deleteModal.hidden = true;
    }
  });

  $("#menuButton").addEventListener("click", () => {
    $("#sidebar").classList.add("open");
    $("#sidebarBackdrop").classList.add("show");
  });

  $("#sidebarBackdrop").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#sidebarBackdrop").classList.remove("show");
  });

  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("#sidebar").classList.remove("open");
      $("#sidebarBackdrop").classList.remove("show");
    });
  });


  const scrollTopButton = $("#scrollTopButton");

  function updateScrollTopButton() {
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const shouldShow = scrollY > 180 && !appShell.hidden;

    scrollTopButton.hidden = false;
    scrollTopButton.classList.toggle("show", shouldShow);
    scrollTopButton.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  }

  scrollTopButton.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });

  window.addEventListener("scroll", updateScrollTopButton, { passive: true });
  window.addEventListener("resize", updateScrollTopButton);
  window.requestAnimationFrame(updateScrollTopButton);

  client.auth.onAuthStateChange((_event, session) => {
    if (!session) showLogin();
  });

  (async function boot() {
    const { data } = await client.auth.getSession();
    if (data.session) await enterApp(data.session);
    else showLogin();
  })();
})();
