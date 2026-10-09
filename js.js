(() => {
  "use strict";

  const SUPABASE_URL = "https://wfxuxrvygyzonkflpwoq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_e2h4t8AvCobzftt36UrDbw_NJGq8qlJ";
  const BUCKET = "dfl-projects";
  const TABLE = "dfl_project_photos";

  // Capture recovery intent before Supabase consumes the URL tokens.
  let recoveringPassword = new URLSearchParams(window.location.search).get("auth") === "recovery" ||
    new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
  const callbackError = new URLSearchParams(window.location.hash.slice(1)).get("error_description");

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "dfl-admin-auth"
    }
  });

  const $ = (selector) => document.querySelector(selector);
  const SAVED_EMAIL_KEY = "dfl_admin_saved_email";

  const loginView = $("#loginView");
  const appView = $("#appView");
  const loginForm = $("#loginForm");
  const loginButton = $("#loginButton");
  const loginError = $("#loginError");
  const saveEmailCheckbox = $("#saveEmail");
  const emailInput = $("#email");

  const forgotPasswordButton = $("#forgotPasswordButton");
  const emailLinkButton = $("#emailLinkButton");
  const loginStatus = $("#loginStatus");
  const resetPasswordForm = $("#resetPasswordForm");
  const resetPasswordError = $("#resetPasswordError");
  let emailRequestBusy = false;

  const fileInput = $("#fileInput");
  const photoGrid = $("#photoGrid");
  const photoCount = $("#photoCount");
  const loadingState = $("#loadingState");
  const emptyState = $("#emptyState");
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
  let appSessionUserId = null;

  function toast(message, type = "ok") {
    const el = $("#toast");
    if (!el) return;

    el.textContent = message;
    el.classList.toggle("error", type === "error");
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 2200);
  }

  function setBusy(button, busy, normalText) {
    if (!button) return;

    button.disabled = busy;

    if (busy) {
      button.dataset.original = button.innerHTML;
      button.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Working…';
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
    return client.storage
      .from(BUCKET)
      .getPublicUrl(path).data.publicUrl;
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

    if (recoveringPassword && user) {
      showPasswordReset();
      return;
    }

    if (!user) {
      showLogin();
      return;
    }

    try {
      const allowed = await checkAdmin(user);

      if (!allowed) {
        await client.auth.signOut();

        showLogin(
          "This account is signed in, but it is not a Desert Forest admin."
        );

        return;
      }
    } catch (error) {
      console.error(error);

      showLogin(
        "Admin access is not set up yet. Run the Supabase admin SQL first."
      );

      return;
    }

    signedInEmail.textContent = user.email || "Admin";

    loginView.hidden = true;
    appView.hidden = false;

    updateScrollTopButton();

    await loadPhotos();
  }

  function showLogin(message = "") {
    appView.hidden = true;
    loginView.hidden = false;

    updateScrollTopButton();

    if (message) {
      loginError.hidden = false;
      loginError.textContent = message;
    } else {
      loginError.hidden = true;
      loginError.textContent = "";
    }
  }

  function showPasswordReset() {
    appView.hidden = true;
    loginView.hidden = false;
    loginForm.hidden = true;
    resetPasswordForm.hidden = false;
  }

  function authRedirect(recovery = false) {
    const url = new URL(window.location.pathname, window.location.origin);
    if (recovery) url.searchParams.set("auth", "recovery");
    return url.href;
  }

  async function sendAuthEmail(recovery) {
    if (emailRequestBusy) return;
    emailInput.value = emailInput.value.trim();
    if (!emailInput.reportValidity()) return;
    const button = recovery ? forgotPasswordButton : emailLinkButton;
    loginError.hidden = true;
    loginStatus.hidden = true;
    emailRequestBusy = true;
    setBusy(button, true);
    forgotPasswordButton.disabled = true;
    emailLinkButton.disabled = true;
    loginButton.disabled = true;
    try {
      const email = emailInput.value;
      const { error } = recovery
        ? await client.auth.resetPasswordForEmail(email, { redirectTo: "https://admin.dflandscape.com/reset-password.html" })
        : await client.auth.signInWithOtp({ email, options: {
            shouldCreateUser: false,
            emailRedirectTo: authRedirect()
          } });
      if (error) throw error;
      if (saveEmailCheckbox.checked) window.localStorage.setItem(SAVED_EMAIL_KEY, email);
      else window.localStorage.removeItem(SAVED_EMAIL_KEY);
      loginStatus.textContent = recovery
        ? "If this email has an account, a password reset link has been sent. Check your inbox and spam folder."
        : "Check your inbox and spam folder for your one-time login link.";
      loginStatus.hidden = false;
    } catch (error) {
      loginError.textContent = error?.message || "Could not send the email. Please try again.";
      loginError.hidden = false;
    } finally {
      emailRequestBusy = false;
      setBusy(button, false);
      forgotPasswordButton.disabled = false;
      emailLinkButton.disabled = false;
      loginButton.disabled = false;
    }
  }

  forgotPasswordButton.addEventListener("click", () => sendAuthEmail(true));
  emailLinkButton.addEventListener("click", () => sendAuthEmail(false));

  resetPasswordForm.addEventListener("submit", async event => {
    event.preventDefault();
    const password = $("#newPassword").value;
    resetPasswordError.hidden = true;
    if (password.length < 8 || password !== $("#confirmPassword").value) {
      resetPasswordError.textContent = password.length < 8
        ? "Use at least 8 characters." : "The passwords do not match.";
      resetPasswordError.hidden = false;
      return;
    }
    const button = $("#resetPasswordButton");
    setBusy(button, true);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      recoveringPassword = false;
      window.history.replaceState({}, "", window.location.pathname);
      resetPasswordForm.reset();
      resetPasswordForm.hidden = true;
      loginForm.hidden = false;
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      await enterApp(data.session);
      toast("Password updated.");
    } catch (error) {
      resetPasswordError.textContent = error?.message || "Could not update your password. Request a new reset link.";
      resetPasswordError.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });

  $("#cancelResetButton").addEventListener("click", async () => {
    recoveringPassword = false;
    window.history.replaceState({}, "", window.location.pathname);
    resetPasswordForm.reset();
    resetPasswordForm.hidden = true;
    loginForm.hidden = false;
    await client.auth.signOut();
    showLogin();
  });

  async function loadPhotos() {
    loadingState.hidden = false;
    emptyState.hidden = true;
    photoGrid.innerHTML = "";

    const { data, error } = await client
      .from(TABLE)
      .select(
        "id,storage_path,label,sort_order,paired_photo_id,created_at"
      )
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    loadingState.hidden = true;

    if (error) {
      console.error(error);

      toast("Could not load photos.", "error");

      photoGrid.innerHTML = `
        <div
          class="state-box"
          style="grid-column:1/-1"
        >
          <strong>Could not load project photos.</strong>
          <span>Make sure you ran the Supabase SQL.</span>
        </div>
      `;

      return;
    }

    photos = data || [];

    // Keep paired Before / After photos together.
    const visited = new Set();
    const normalized = [];

    for (const photo of photos) {
      if (visited.has(photo.id)) continue;

      visited.add(photo.id);

      const partner = photo.paired_photo_id
        ? photos.find(
            (item) => item.id === photo.paired_photo_id
          )
        : null;

      if (partner && !visited.has(partner.id)) {
        visited.add(partner.id);

        if (photo.label === "before") {
          normalized.push(photo, partner);
        } else if (partner.label === "before") {
          normalized.push(partner, photo);
        } else {
          normalized.push(photo, partner);
        }
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

    photoGrid.innerHTML = photos
      .map((photo, index) => photoCard(photo, index))
      .join("");

    wireCards();
    initSortable();
  }

  function pairedDescription(photo) {
    if (!photo?.paired_photo_id) {
      return "None";
    }

    const paired = photos.find(
      (item) => item.id === photo.paired_photo_id
    );

    if (!paired) {
      return "Linked photo";
    }

    const pairIndex = photos.findIndex(
      (item) => item.id === paired.id
    );

    const pairLabel =
      paired.label === "before"
        ? "Before"
        : paired.label === "after"
          ? "After"
          : "—";

    return `${pairLabel} • Position ${pairIndex + 1}`;
  }

  function photoCard(photo, index) {
    const label =
      photo.label === "before"
        ? "Before"
        : photo.label === "after"
          ? "After"
          : "—";

    const src = publicUrl(photo.storage_path);

    return `
      <article
        class="photo-card"
        data-id="${escapeHtml(photo.id)}"
      >
        <div class="photo-image-wrap">

          <img
            src="${escapeHtml(src)}"
            alt="Project photo ${index + 1}"
            loading="lazy"
          >

          <span class="order-badge">
            ${index + 1}
          </span>

          ${
            photo.label === "before" ||
            photo.label === "after"
              ? `
                <span class="label-badge">
                  ${label}
                </span>
              `
              : ""
          }

          <button
            class="drag-handle"
            type="button"
            title="Drag to reorder"
            aria-label="Drag photo ${index + 1} to reorder"
          >
            <i class="fa-solid fa-grip-vertical"></i>
          </button>

          <button
            class="home-star ${
              index < 6 ? "featured" : ""
            }"
            type="button"
            data-featured
            title="${
              index < 6
                ? "Currently on homepage"
                : "Put this photo on homepage"
            }"
            aria-label="${
              index < 6
                ? `Photo ${index + 1} is currently on the homepage`
                : `Put photo ${index + 1} on the homepage`
            }"
          >
            <i
              class="${
                index < 6
                  ? "fa-solid"
                  : "fa-regular"
              } fa-star"
            ></i>
          </button>

        </div>

        <div class="photo-body">

          <div
            class="label-toggle"
            aria-label="Photo label"
          >
            <button
              type="button"
              data-label="before"
              class="${
                photo.label === "before"
                  ? "active"
                  : ""
              }"
            >
              Before
            </button>

            <button
              type="button"
              data-label="after"
              class="${
                photo.label === "after"
                  ? "active"
                  : ""
              }"
            >
              After
            </button>

            <button
              type="button"
              data-label="none"
              class="no-label-option ${
                photo.label !== "before" &&
                photo.label !== "after"
                  ? "active"
                  : ""
              }"
              title="No label"
              aria-label="No Before or After label"
            >
              -
            </button>
          </div>

          <div class="card-actions">

            <span class="card-position">
              Position ${index + 1}
            </span>

            <div
              style="
                display:flex;
                gap:7px;
                align-items:center;
              "
            >

              <button
                class="
                  pair-button
                  ${
                    photo.paired_photo_id
                      ? "paired"
                      : ""
                  }
                  ${
                    photo.label !== "before" &&
                    photo.label !== "after"
                      ? "disabled-pair"
                      : ""
                  }
                "
                type="button"
                data-pair
                title="${
                  photo.label !== "before" &&
                  photo.label !== "after"
                    ? "Choose Before or After before pairing"
                    : photo.paired_photo_id
                      ? "Change paired photo"
                      : "Pair before and after"
                }"
              >
                <i class="fa-solid fa-link"></i>

                ${
                  photo.paired_photo_id
                    ? "Change Pair"
                    : "Pair"
                }
              </button>

              ${
                photo.paired_photo_id
                  ? `
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
                  `
                  : ""
              }

              <button
                class="delete-button"
                type="button"
                data-delete
                title="Delete photo"
                aria-label="Delete photo ${index + 1}"
              >
                <i class="fa-regular fa-trash-can"></i>
              </button>

            </div>
          </div>

          ${
            photo.paired_photo_id
              ? `
                <div class="pair-meta">
                  <strong>Paired:</strong>
                  ${pairedDescription(photo)}
                </div>
              `
              : ""
          }

        </div>
      </article>
    `;
  }

  function openPairModal(photo) {
    if (
      photo.label !== "before" &&
      photo.label !== "after"
    ) {
      toast(
        "Choose Before or After before pairing this photo.",
        "error"
      );

      return;
    }

    pendingPairPhoto = photo;
    selectedPairId =
      photo.paired_photo_id || null;

    const targetLabel =
      photo.label === "before"
        ? "after"
        : "before";

    $("#pairModalCopy").textContent =
      `This is marked ${photo.label.toUpperCase()}. ` +
      `Choose a ${targetLabel.toUpperCase()} photo to pair with it.`;

    const choices = photos.filter(
      (item) =>
        item.id !== photo.id &&
        item.label === targetLabel
    );

    pairChoices.innerHTML = choices.length
      ? choices
          .map((item) => {
            const index = photos.findIndex(
              (x) => x.id === item.id
            );

            const selected =
              selectedPairId === item.id;

            return `
              <button
                type="button"
                class="
                  featured-choice
                  ${selected ? "selected" : ""}
                "
                data-pair-id="${escapeHtml(item.id)}"
                aria-label="
                  Pair with ${targetLabel}
                  photo ${index + 1}
                "
              >
                <img
                  src="${escapeHtml(
                    publicUrl(item.storage_path)
                  )}"
                  alt="
                    ${targetLabel}
                    photo ${index + 1}
                  "
                >

                <span>
                  ${index + 1}
                </span>

                <em class="pair-choice-type">
                  ${targetLabel.toUpperCase()}
                </em>

                <b class="featured-check">
                  <i class="fa-solid fa-check"></i>
                </b>
              </button>
            `;
          })
          .join("")
      : `
        <div class="featured-empty">
          No ${targetLabel} photos are available yet.
        </div>
      `;

    pairChoices
      .querySelectorAll("[data-pair-id]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          selectedPairId =
            button.dataset.pairId;

          pairChoices
            .querySelectorAll(".featured-choice")
            .forEach((choice) => {
              choice.classList.toggle(
                "selected",
                choice === button
              );
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
    const first = photos.find(
      (item) => item.id === firstId
    );

    const second = photos.find(
      (item) => item.id === secondId
    );

    if (!first || !second) return;

    if (
      !["before", "after"].includes(first.label) ||
      !["before", "after"].includes(second.label)
    ) {
      return;
    }

    const before =
      first.label === "before"
        ? first
        : second;

    const after =
      before.id === first.id
        ? second
        : first;

    const firstIndex = photos.findIndex(
      (item) => item.id === first.id
    );

    const secondIndex = photos.findIndex(
      (item) => item.id === second.id
    );

    const insertAt = Math.max(
      0,
      Math.min(firstIndex, secondIndex)
    );

    const remaining = photos.filter(
      (item) =>
        item.id !== first.id &&
        item.id !== second.id
    );

    remaining.splice(
      insertAt,
      0,
      before,
      after
    );

    photos = remaining.map(
      (item, index) => ({
        ...item,
        sort_order: index + 1
      })
    );
  }

  async function unpairPhoto(photo) {
    if (!photo?.paired_photo_id) return;

    const otherId =
      photo.paired_photo_id;

    const { error: firstError } =
      await client
        .from(TABLE)
        .update({
          paired_photo_id: null
        })
        .eq("id", photo.id);

    if (firstError) {
      throw firstError;
    }

    const { error: secondError } =
      await client
        .from(TABLE)
        .update({
          paired_photo_id: null
        })
        .eq("id", otherId)
        .eq(
          "paired_photo_id",
          photo.id
        );

    if (secondError) {
      throw secondError;
    }
  }

  function openFeaturedModal(photo) {
    const index = photos.findIndex(
      (item) => item.id === photo.id
    );

    if (
      index >= 0 &&
      index < 6
    ) {
      toast(
        `This photo is already homepage slot ${index + 1}.`
      );

      return;
    }

    pendingFeaturedPhoto = photo;
    selectedFeaturedId = null;
    saveFeatured.disabled = true;

    const currentSix =
      photos.slice(0, 6);

    featuredChoices.innerHTML =
      currentSix.length
        ? currentSix
            .map(
              (item, slot) => `
                <button
                  type="button"
                  class="featured-choice"
                  data-replace-id="${escapeHtml(item.id)}"
                  aria-label="
                    Replace homepage photo ${slot + 1}
                  "
                >
                  <img
                    src="${escapeHtml(
                      publicUrl(item.storage_path)
                    )}"
                    alt="
                      Current homepage photo ${slot + 1}
                    "
                  >

                  <span>
                    ${slot + 1}
                  </span>

                  <b class="featured-check">
                    <i class="fa-solid fa-check"></i>
                  </b>
                </button>
              `
            )
            .join("")
        : `
          <div class="featured-empty">
            There are no current homepage photos to replace yet.
          </div>
        `;

    featuredChoices
      .querySelectorAll("[data-replace-id]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          selectedFeaturedId =
            button.dataset.replaceId;

          featuredChoices
            .querySelectorAll(".featured-choice")
            .forEach((choice) => {
              choice.classList.toggle(
                "selected",
                choice === button
              );
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
    for (
      let i = 0;
      i < order.length;
      i++
    ) {
      const { error } = await client
        .from(TABLE)
        .update({
          sort_order: i + 1
        })
        .eq("id", order[i].id);

      if (error) {
        throw error;
      }
    }
  }

  function wireCards() {
    photoGrid
      .querySelectorAll("[data-unpair]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          async (event) => {
            event.stopPropagation();

            const card =
              button.closest(".photo-card");

            const photo =
              photos.find(
                (item) =>
                  item.id === card.dataset.id
              );

            if (
              !photo?.paired_photo_id
            ) {
              return;
            }

            const partner =
              photos.find(
                (item) =>
                  item.id ===
                  photo.paired_photo_id
              );

            const confirmed =
              window.confirm(
                `Unpair this ${photo.label.toUpperCase()} photo${
                  partner
                    ? ` from its ${partner.label.toUpperCase()} photo`
                    : ""
                }?`
              );

            if (!confirmed) {
              return;
            }

            try {
              await unpairPhoto(photo);

              const partnerId =
                photo.paired_photo_id;

              photo.paired_photo_id =
                null;

              if (partnerId) {
                const localPartner =
                  photos.find(
                    (item) =>
                      item.id === partnerId
                  );

                if (localPartner) {
                  localPartner.paired_photo_id =
                    null;
                }
              }

              render();

              toast(
                "Photos unpaired."
              );
            } catch (error) {
              console.error(error);

              toast(
                "Could not unpair the photos.",
                "error"
              );
            }
          }
        );
      });

    photoGrid
      .querySelectorAll(".photo-card")
      .forEach((card) => {
        card.addEventListener(
          "click",
          (event) => {
            if (
              event.target.closest("button") ||
              event.target.closest(".label-toggle")
            ) {
              return;
            }

            const id =
              card.dataset.id;

            const alreadySelected =
              card.classList.contains(
                "pair-selected"
              );

            if (alreadySelected) {
              clearPairSelection();
            } else {
              highlightPair(
                id,
                false
              );
            }
          }
        );
      });

    photoGrid
      .querySelectorAll("[data-pair]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const card =
              button.closest(".photo-card");

            const photo =
              photos.find(
                (item) =>
                  item.id === card.dataset.id
              );

            if (!photo) return;

            openPairModal(photo);
          }
        );
      });

    photoGrid
      .querySelectorAll("[data-featured]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const card =
              button.closest(".photo-card");

            const photo =
              photos.find(
                (item) =>
                  item.id === card.dataset.id
              );

            if (photo) {
              openFeaturedModal(photo);
            }
          }
        );
      });

    photoGrid
      .querySelectorAll("[data-label]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          async () => {
            const card =
              button.closest(".photo-card");

            const id =
              card.dataset.id;

            const label =
              button.dataset.label;

            const photo =
              photos.find(
                (item) =>
                  item.id === id
              );

            if (
              !photo ||
              photo.label === label
            ) {
              return;
            }

            const oldLabel =
              photo.label;

            if (
              label === "none" &&
              photo.paired_photo_id
            ) {
              try {
                const partnerId =
                  photo.paired_photo_id;

                await unpairPhoto(
                  photo
                );

                photo.paired_photo_id =
                  null;

                const partner =
                  photos.find(
                    (item) =>
                      item.id === partnerId
                  );

                if (partner) {
                  partner.paired_photo_id =
                    null;
                }
              } catch (
                unpairError
              ) {
                console.error(
                  unpairError
                );

                toast(
                  "Could not remove the existing pair.",
                  "error"
                );

                return;
              }
            }

            photo.label = label;

            render();

            const { error } =
              await client
                .from(TABLE)
                .update({
                  label
                })
                .eq("id", id);

            if (error) {
              console.error(
                error
              );

              photo.label =
                oldLabel;

              render();

              toast(
                "Could not save the label.",
                "error"
              );

              return;
            }

            if (
              photo.paired_photo_id
            ) {
              orderPairBeforeAfter(
                photo.id,
                photo.paired_photo_id
              );

              try {
                await persistPhotoOrder(
                  photos
                );
              } catch (
                orderError
              ) {
                console.error(
                  orderError
                );
              }

              render();
            }

            toast(
              label === "none"
                ? "Photo label removed."
                : `Marked as ${label}.`
            );
          }
        );
      });

    photoGrid
      .querySelectorAll("[data-delete]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const card =
              button.closest(".photo-card");

            pendingDelete =
              photos.find(
                (item) =>
                  item.id === card.dataset.id
              ) || null;

            if (pendingDelete) {
              deleteModal.hidden =
                false;
            }
          }
        );
      });
  }

  function getPairMembers(photoId) {
    const photo =
      photos.find(
        (item) =>
          item.id === photoId
      );

    if (!photo) {
      return [];
    }

    const ids = [photo.id];

    if (photo.paired_photo_id) {
      ids.push(
        photo.paired_photo_id
      );
    }

    return ids
      .map((id) =>
        photos.find(
          (item) => item.id === id
        )
      )
      .filter(Boolean);
  }

  function clearPairSelection() {
    photoGrid
      .querySelectorAll(".photo-card")
      .forEach((card) => {
        card.classList.remove(
          "pair-selected",
          "pair-dragging"
        );
      });
  }

  function highlightPair(
    photoId,
    dragging = false
  ) {
    clearPairSelection();

    const members =
      getPairMembers(photoId);

    members.forEach(
      (member) => {
        const card =
          photoGrid.querySelector(
            `.photo-card[data-id="${CSS.escape(
              member.id
            )}"]`
          );

        if (!card) return;

        card.classList.add(
          "pair-selected"
        );

        if (dragging) {
          card.classList.add(
            "pair-dragging"
          );
        }
      }
    );
  }

  function makePairsAdjacent(
    order,
    movedId
  ) {
    const moved =
      order.find(
        (item) =>
          item.id === movedId
      );

    if (
      !moved?.paired_photo_id
    ) {
      return order;
    }

    const partnerIndex =
      order.findIndex(
        (item) =>
          item.id ===
          moved.paired_photo_id
      );

    const movedIndex =
      order.findIndex(
        (item) =>
          item.id === moved.id
      );

    if (
      partnerIndex < 0 ||
      movedIndex < 0
    ) {
      return order;
    }

    const partner =
      order[partnerIndex];

    let remaining =
      order.filter(
        (item) =>
          item.id !== moved.id &&
          item.id !== partner.id
      );

    const pairBlock =
      moved.label === "before"
        ? [
            moved,
            partner
          ]
        : partner.label === "before"
          ? [
              partner,
              moved
            ]
          : [
              moved,
              partner
            ];

    const originalVisibleOrder =
      [
        ...photoGrid.querySelectorAll(
          ".photo-card"
        )
      ]
        .map(
          (el) =>
            el.dataset.id
        )
        .filter(
          (id) =>
            id !== partner.id
        );

    let insertAt =
      originalVisibleOrder.indexOf(
        moved.id
      );

    if (insertAt < 0) {
      insertAt =
        remaining.length;
    }

    insertAt =
      Math.min(
        insertAt,
        remaining.length
      );

    remaining.splice(
      insertAt,
      0,
      ...pairBlock
    );

    return remaining;
  }

  function initSortable() {
    if (sortable) {
      sortable.destroy();
    }

    sortable = new Sortable(
      photoGrid,
      {
        animation: 180,
        handle: ".drag-handle",
        ghostClass: "sortable-ghost",
        forceFallback: true,
        fallbackOnBody: true,

        onChoose: (event) => {
          const id =
            event.item?.dataset?.id;

          if (id) {
            highlightPair(
              id,
              false
            );
          }
        },

        onStart: (event) => {
          const id =
            event.item?.dataset?.id;

          if (id) {
            highlightPair(
              id,
              true
            );
          }
        },

        onUnchoose: () => {
          clearPairSelection();
        },

        onEnd: async (event) => {
          const movedId =
            event.item?.dataset?.id;

          const ids = [
            ...photoGrid.querySelectorAll(
              ".photo-card"
            )
          ].map(
            (el) =>
              el.dataset.id
          );

          const byId =
            new Map(
              photos.map(
                (photo) => [
                  photo.id,
                  photo
                ]
              )
            );

          let reordered =
            ids
              .map(
                (id) =>
                  byId.get(id)
              )
              .filter(Boolean);

          if (movedId) {
            reordered =
              makePairsAdjacent(
                reordered,
                movedId
              );
          }

          photos =
            reordered.map(
              (
                photo,
                index
              ) => ({
                ...photo,
                sort_order:
                  index + 1
              })
            );

          render();

          try {
            await persistPhotoOrder(
              photos
            );

            toast(
              getPairMembers(
                movedId
              ).length > 1
                ? "Paired photos moved together."
                : "Photo order saved."
            );
          } catch (error) {
            console.error(
              error
            );

            toast(
              "Could not save the new order.",
              "error"
            );

            await loadPhotos();
          }
        }
      }
    );
  }

  async function saveNewOrder() {
    const ids = [
      ...photoGrid.querySelectorAll(
        ".photo-card"
      )
    ].map(
      (el) =>
        el.dataset.id
    );

    const byId =
      new Map(
        photos.map(
          (photo) => [
            photo.id,
            photo
          ]
        )
      );

    const reordered =
      ids
        .map(
          (id) =>
            byId.get(id)
        )
        .filter(Boolean);

    const previous =
      photos.slice();

    photos =
      reordered.map(
        (
          photo,
          index
        ) => ({
          ...photo,
          sort_order:
            index + 1
        })
      );

    render();

    try {
      await persistPhotoOrder(
        photos
      );

      toast(
        "Photo order saved."
      );
    } catch (error) {
      console.error(
        error
      );

      photos =
        previous;

      render();

      toast(
        "Could not save the new order.",
        "error"
      );
    }
  }

  function safeFilename(name) {
    const dot =
      name.lastIndexOf(".");

    const extension =
      dot >= 0
        ? name
            .slice(dot)
            .toLowerCase()
        : "";

    const base =
      (
        dot >= 0
          ? name.slice(0, dot)
          : name
      )
        .toLowerCase()
        .replace(
          /[^a-z0-9]+/g,
          "-"
        )
        .replace(
          /^-+|-+$/g,
          ""
        )
        .slice(0, 60) ||
      "photo";

    return `${base}${extension}`;
  }

  async function uploadFiles(files) {
    const allowed =
      new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif"
      ]);

    const valid =
      files.filter(
        (file) =>
          allowed.has(file.type) &&
          file.size <=
            10 *
              1024 *
              1024
      );

    if (!valid.length) {
      toast(
        "Choose JPG, PNG, WEBP, or AVIF images under 10 MB.",
        "error"
      );

      return;
    }

    const uploadButton =
      document.querySelector(
        ".upload-button"
      );

    uploadButton.style.pointerEvents =
      "none";

    uploadButton.style.opacity =
      ".6";

    let nextOrder =
      photos.length + 1;

    let uploaded = 0;

    try {
      for (
        const file of valid
      ) {
        const storagePath =
          `projects/${crypto.randomUUID()}-${safeFilename(
            file.name
          )}`;

        const {
          error: uploadError
        } = await client.storage
          .from(BUCKET)
          .upload(
            storagePath,
            file,
            {
              cacheControl:
                "3600",
              upsert: false,
              contentType:
                file.type
            }
          );

        if (uploadError) {
          throw uploadError;
        }

        const {
          error: insertError
        } = await client
          .from(TABLE)
          .insert({
            storage_path:
              storagePath,

            label:
              "none",

            sort_order:
              nextOrder
          });

        if (insertError) {
          await client.storage
            .from(BUCKET)
            .remove([
              storagePath
            ]);

          throw insertError;
        }

        nextOrder += 1;
        uploaded += 1;
      }

      await loadPhotos();

      toast(
        `${uploaded} photo${
          uploaded === 1
            ? ""
            : "s"
        } uploaded.`
      );
    } catch (error) {
      console.error(error);

      toast(
        error.message ||
          "Upload failed.",
        "error"
      );

      await loadPhotos();
    } finally {
      uploadButton.style.pointerEvents =
        "";

      uploadButton.style.opacity =
        "";

      fileInput.value =
        "";
    }
  }

  loginForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (emailRequestBusy) return;
      loginStatus.hidden = true;

      loginError.hidden =
        true;

      setBusy(
        loginButton,
        true
      );

      const email =
        emailInput.value.trim();

      const password =
        $("#password").value;

      try {
        const {
          data,
          error
        } =
          await client.auth
            .signInWithPassword({
              email,
              password
            });

        if (error) {
          loginError.hidden =
            false;

          loginError.textContent =
            error.message ||
            "Could not sign in. Check your email and password.";

          return;
        }

        if (
          saveEmailCheckbox.checked
        ) {
          window.localStorage
            .setItem(
              SAVED_EMAIL_KEY,
              email
            );
        } else {
          window.localStorage
            .removeItem(
              SAVED_EMAIL_KEY
            );
        }

        appSessionUserId =
          data.session
            ?.user?.id ||
          null;

        await enterApp(
          data.session
        );
      } catch (error) {
        console.error(
          "Sign in failed:",
          error
        );

        loginError.hidden =
          false;

        loginError.textContent =
          error?.message ||
          "Could not sign in. Please try again.";
      } finally {
        setBusy(
          loginButton,
          false
        );
      }
    }
  );

  $("#togglePassword")
    .addEventListener(
      "click",
      () => {
        const input =
          $("#password");

        const icon =
          $("#togglePassword i");

        const showing =
          input.type ===
          "text";

        input.type =
          showing
            ? "password"
            : "text";

        icon.className =
          showing
            ? "fa-regular fa-eye"
            : "fa-regular fa-eye-slash";
      }
    );

  $("#signOutButton")
    .addEventListener(
      "click",
      async () => {
        await client.auth.signOut();

        appSessionUserId =
          null;

        photos = [];

        showLogin();
      }
    );

  fileInput.addEventListener(
    "change",
    () =>
      uploadFiles([
        ...fileInput.files
      ])
  );

  $("#cancelPair")
    .addEventListener(
      "click",
      closePairModal
    );

  savePair.addEventListener(
    "click",
    async () => {
      if (
        !pendingPairPhoto ||
        !selectedPairId
      ) {
        return;
      }

      const photo =
        pendingPairPhoto;

      const other =
        photos.find(
          (item) =>
            item.id ===
            selectedPairId
        );

      if (!other) return;

      if (
        photo.label ===
        other.label
      ) {
        toast(
          "Before photos can only pair with After photos.",
          "error"
        );

        return;
      }

      setBusy(
        savePair,
        true
      );

      try {
        if (
          photo.paired_photo_id &&
          photo.paired_photo_id !==
            other.id
        ) {
          await unpairPhoto(
            photo
          );
        }

        if (
          other.paired_photo_id &&
          other.paired_photo_id !==
            photo.id
        ) {
          await unpairPhoto(
            other
          );
        }

        const {
          error: firstError
        } = await client
          .from(TABLE)
          .update({
            paired_photo_id:
              other.id
          })
          .eq(
            "id",
            photo.id
          );

        if (firstError) {
          throw firstError;
        }

        const {
          error: secondError
        } = await client
          .from(TABLE)
          .update({
            paired_photo_id:
              photo.id
          })
          .eq(
            "id",
            other.id
          );

        if (secondError) {
          throw secondError;
        }

        photo.paired_photo_id =
          other.id;

        other.paired_photo_id =
          photo.id;

        orderPairBeforeAfter(
          photo.id,
          other.id
        );

        await persistPhotoOrder(
          photos
        );

        closePairModal();

        render();

        toast(
          "Paired — Before is first, After is second."
        );
      } catch (error) {
        console.error(
          error
        );

        toast(
          "Could not save the pair.",
          "error"
        );
      } finally {
        setBusy(
          savePair,
          false
        );
      }
    }
  );

  pairModal.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        pairModal
      ) {
        closePairModal();
      }
    }
  );

  $("#cancelFeatured")
    .addEventListener(
      "click",
      closeFeaturedModal
    );

  saveFeatured.addEventListener(
    "click",
    async () => {
      if (
        !pendingFeaturedPhoto ||
        !selectedFeaturedId
      ) {
        return;
      }

      const incomingIndex =
        photos.findIndex(
          (item) =>
            item.id ===
            pendingFeaturedPhoto.id
        );

      const replaceIndex =
        photos.findIndex(
          (item) =>
            item.id ===
            selectedFeaturedId
        );

      if (
        incomingIndex < 0 ||
        replaceIndex < 0 ||
        replaceIndex >= 6
      ) {
        return;
      }

      const previous =
        photos.map(
          (item) => ({
            ...item
          })
        );

      const incoming =
        photos[incomingIndex];

      const outgoing =
        photos[replaceIndex];

      photos[replaceIndex] =
        incoming;

      photos[incomingIndex] =
        outgoing;

      photos =
        photos.map(
          (
            item,
            index
          ) => ({
            ...item,
            sort_order:
              index + 1
          })
        );

      setBusy(
        saveFeatured,
        true
      );

      try {
        await persistPhotoOrder(
          photos
        );

        closeFeaturedModal();

        render();

        toast(
          `Homepage photo ${replaceIndex + 1} switched.`
        );
      } catch (error) {
        console.error(
          error
        );

        photos =
          previous;

        render();

        toast(
          "Could not switch the homepage photo.",
          "error"
        );
      } finally {
        setBusy(
          saveFeatured,
          false
        );
      }
    }
  );

  featuredModal.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        featuredModal
      ) {
        closeFeaturedModal();
      }
    }
  );

  $("#cancelDelete")
    .addEventListener(
      "click",
      () => {
        pendingDelete =
          null;

        deleteModal.hidden =
          true;
      }
    );

  $("#confirmDelete")
    .addEventListener(
      "click",
      async () => {
        if (!pendingDelete) {
          return;
        }

        const button =
          $("#confirmDelete");

        setBusy(
          button,
          true
        );

        const target =
          pendingDelete;

        const {
          error: rowError
        } = await client
          .from(TABLE)
          .delete()
          .eq(
            "id",
            target.id
          );

        if (rowError) {
          console.error(
            rowError
          );

          setBusy(
            button,
            false
          );

          toast(
            "Could not delete the photo.",
            "error"
          );

          return;
        }

        const {
          error: storageError
        } =
          await client.storage
            .from(BUCKET)
            .remove([
              target.storage_path
            ]);

        if (storageError) {
          console.warn(
            "Photo row deleted, but storage cleanup failed:",
            storageError
          );
        }

        pendingDelete =
          null;

        deleteModal.hidden =
          true;

        setBusy(
          button,
          false
        );

        await loadPhotos();

        await saveNewOrder();

        toast(
          "Photo deleted."
        );
      }
    );

  deleteModal.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        deleteModal
      ) {
        pendingDelete =
          null;

        deleteModal.hidden =
          true;
      }
    }
  );

  $("#menuButton")
    ?.addEventListener(
      "click",
      () => {
        $("#sidebar")
          ?.classList
          .add("open");

        $("#sidebarBackdrop")
          ?.classList
          .add("show");
      }
    );

  $("#sidebarBackdrop")
    ?.addEventListener(
      "click",
      () => {
        $("#sidebar")
          ?.classList
          .remove("open");

        $("#sidebarBackdrop")
          ?.classList
          .remove("show");
      }
    );

  // Read-only admin analytics. RLS restricts records to dfl_admins.
  const statsRange = $("#statsRange");
  const statsStatus = $("#statsStatus");
  const statsResults = $("#statsResults");
  let statsRequest = 0;

  const num = value => Number(value || 0).toLocaleString("en-US");
  function statsDateKey(value) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(value);
    const get = type => parts.find(part => part.type === type)?.value || "";
    return get("year") + "-" + get("month") + "-" + get("day");
  }
  function renderStatsRows(container, rows, empty = "No events recorded yet") {
    container.replaceChildren();
    if (!rows.length) {
      const p = document.createElement("p");
      p.className = "stats-no-data";
      p.textContent = empty;
      container.appendChild(p);
      return;
    }
    const max = Math.max(...rows.map(row => row.count), 1);
    rows.forEach(row => {
      const line = document.createElement("div");
      line.className = "stats-progress-row";
      const label = document.createElement("div");
      label.className = "stats-progress-label";
      const name = document.createElement("span");
      name.textContent = row.name;
      const count = document.createElement("strong");
      count.textContent = num(row.count);
      label.append(name, count);
      const track = document.createElement("div");
      track.className = "stats-progress-track";
      const bar = document.createElement("div");
      bar.className = "stats-progress-fill";
      bar.style.width = (row.count / max * 100) + "%";
      track.appendChild(bar);
      line.append(label, track);
      container.appendChild(line);
    });
  }

  const reportTz = "America/Los_Angeles";
  let weeklyCsv = "";
  // Count meaningful contact intent, not ordinary navigation to #contact.
  const contactEvent = event => (
    event.event_type === "form_submit" ||
    (event.event_type === "click" &&
      (event.event_name === "call_now" ||
       event.event_name === "email_click" ||
       event.event_name === "contact_submit_click" ||
       /(?:^|_)estimate(?:_|$)/i.test(event.event_name)))
  );
  // Work with Las Vegas calendar-day keys to avoid browser timezone differences.
  function shiftDay(dayKey, offset) {
    const [y, m, d] = dayKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  }
  function mondayOf(dayKey) {
    const [y, m, d] = dayKey.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return shiftDay(dayKey, -((weekday + 6) % 7));
  }
  function comparisonStats(rows) {
    const pages = rows.filter(e => e.event_type === "page_view");
    const visitors = new Set(pages.map(e => e.visitor_id));
    const contacted = new Set(rows.filter(contactEvent).map(e => e.visitor_id)
      .filter(id => visitors.has(id)));
    return {
      visitors: visitors.size,
      contacts: rows.filter(contactEvent).length,
      rate: visitors.size ? contacted.size / visitors.size * 100 : 0
    };
  }
  function changeLabel(current, previous, rate = false) {
    if (!previous) return current ? "New (no prior baseline)" : "No prior data";
    const difference = (current - previous) / previous * 100;
    return (difference > 0 ? "+" : "") + difference.toFixed(1) + "%" + (rate ? " vs last week" : " vs last week");
  }
  function renderWeeklyReport(rows, todayKey) {
    const weekStart = mondayOf(todayKey);
    const elapsed = Math.round((Date.parse(todayKey + "T00:00:00Z") - Date.parse(weekStart + "T00:00:00Z")) / 86400000);
    const lastWeekStart = shiftDay(weekStart, -7);
    const lastWeekEnd = shiftDay(lastWeekStart, elapsed);
    const current = comparisonStats(rows.filter(e => {
      const k = statsDateKey(new Date(e.created_at));
      return k >= weekStart && k <= todayKey;
    }));
    const previous = comparisonStats(rows.filter(e => {
      const k = statsDateKey(new Date(e.created_at));
      return k >= lastWeekStart && k <= lastWeekEnd;
    }));
    $("#weeklyVisitors").textContent = num(current.visitors);
    $("#weeklyContacts").textContent = num(current.contacts);
    $("#weeklyRate").textContent = current.rate.toFixed(1) + "%";
    $("#weeklyVisitorsChange").textContent = changeLabel(current.visitors, previous.visitors);
    $("#weeklyContactsChange").textContent = changeLabel(current.contacts, previous.contacts);
    $("#weeklyRateChange").textContent = previous.visitors ? (current.rate - previous.rate >= 0 ? "+" : "") + (current.rate - previous.rate).toFixed(1) + " percentage points" : "No prior data";
    const csvCells = values => values.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",");
    weeklyCsv = [
      csvCells(["Metric","This week to date","Same days last week","Change"]),
      csvCells(["Visitors",current.visitors,previous.visitors,changeLabel(current.visitors,previous.visitors)]),
      csvCells(["Contact actions",current.contacts,previous.contacts,changeLabel(current.contacts,previous.contacts)]),
      csvCells(["Action rate",current.rate.toFixed(1)+"%",previous.rate.toFixed(1)+"%",$("#weeklyRateChange").textContent]),
    ].join("\r\n");
    $("#statsExportCsv").disabled = false;
  }
  $("#statsExportCsv")?.addEventListener("click", () => {
    if (!weeklyCsv) return;
    const blob = new Blob([weeklyCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dfl-website-weekly-report-" + statsDateKey(new Date()) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  async function loadWebsiteStats() {
    const request = ++statsRequest;
    statsStatus.textContent = "Loading real website statistics…";
    statsResults.hidden = true;
    weeklyCsv = "";
    $("#statsExportCsv").disabled = true;
    const days = Number(statsRange.value);
    const now = new Date();
    const today = statsDateKey(now);
    const todayStart = new Date(now);
    // Compute LA midnight without depending on the viewer's local timezone.
    const laClock = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).formatToParts(now);
    const part = type => Number(laClock.find(x => x.type === type)?.value || 0);
    const timeSinceMidnight = ((part("hour") % 24) * 3600 + part("minute") * 60 + part("second")) * 1000;
    todayStart.setTime(now.getTime() - timeSinceMidnight);
    const since = new Date(todayStart.getTime() - (days - 1) * 86400000);
    const weeklyStart = new Date(todayStart.getTime() - 13 * 86400000);
    const fetchStart = weeklyStart < since ? weeklyStart : since;
    try {
      const events = [];
      const pageSize = 1000;
      // Fetch all event pages, avoiding Supabase's default 1000-row cap.
      for (let offset = 0; offset < 50000; offset += pageSize) {
        const { data, error } = await client.from("dfl_analytics_events")
          .select("created_at,event_type,event_name,visitor_id,session_id,page_path,device_type,referrer_host")
          .gte("created_at", fetchStart.toISOString())
          .order("created_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        if (request !== statsRequest) return;
        events.push(...(data || []));
        if (!data || data.length < pageSize) break;
        if (offset + pageSize >= 50000) throw new Error("Too many events for this report. Server-side aggregation is needed.");
      }
      renderWeeklyReport(events, today);
      const inRange = events.filter(e => new Date(e.created_at) >= since);
      const views = inRange.filter(e => e.event_type === "page_view");
      const clicks = inRange.filter(e => e.event_type === "click");
      const contactActions = inRange.filter(contactEvent);
      $("#statPageViews").textContent = num(views.length);
      $("#statVisitors").textContent = num(new Set(views.map(e => e.visitor_id)).size);
      $("#statClicks").textContent = num(clicks.length);
      $("#statContacts").textContent = num(contactActions.length);
      $("#statSessions").textContent = num(new Set(inRange.map(e => e.session_id)).size);
      const recentCutoff = Date.now() - 5 * 60 * 1000;
      $("#statActive").textContent = num(new Set(inRange.filter(e => new Date(e.created_at).getTime() >= recentCutoff).map(e => e.visitor_id)).size);
      const counts = (items, key) => {
        const map = new Map();
        for (const item of items) {
          const name = String(key(item) || "Unknown");
          map.set(name, (map.get(name) || 0) + 1);
        }
        return [...map].map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count);
      };
      // Use visit dates in Las Vegas time.
      const byDay = counts(views, e => statsDateKey(new Date(e.created_at))).sort((a,b) => a.name.localeCompare(b.name));
      renderStatsRows($("#statsVisitChart"), byDay);
      renderStatsRows($("#statsClickChart"), counts(clicks, e => e.event_name).slice(0, 12));
      renderStatsRows($("#statsPages"), counts(views, e => e.page_path === "/" || e.page_path === "/index.html" ? "Homepage" : e.page_path).slice(0, 10));
      // Device shares are based on page views within the selected period.
      const deviceRows = ["mobile", "desktop", "tablet", "unknown"].map(type => ({
        name: type.charAt(0).toUpperCase() + type.slice(1),
        count: views.filter(e => e.device_type === type).length
      }));
      renderStatsRows($("#statsDevices"), deviceRows.filter(r => r.count || r.name !== "Unknown")
        .map(r => ({ ...r, name: r.name + " — " + (views.length ? (100 * r.count / views.length).toFixed(1) : "0.0") + "%" })));
      renderStatsRows($("#statsSources"), counts(views, e => e.referrer_host || "Direct / unknown").slice(0, 12));
      statsResults.hidden = false;
      statsStatus.textContent = inRange.length
        ? "Based on " + num(inRange.length) + " tracked events since " + since.toLocaleDateString("en-US") + "."
        : "No tracked events found for this period yet.";
    } catch (error) {
      if (request !== statsRequest) return;
      console.error("Website analytics loading failed:", error);
      statsStatus.textContent = "Couldn't load analytics. Run the Batch 4 admin read-access SQL in Supabase, then refresh. " + (error?.message || "");
    }
  }
  statsRange?.addEventListener("change", loadWebsiteStats);
  $("#refreshStats")?.addEventListener("click", loadWebsiteStats);

  const photosView = $("#photosView");
  const statsView = $("#statsView");
  const pageTitle = $("#pageTitle");
  const pageEyebrow = $("#pageEyebrow");
  const uploadPhotosAction = $("#uploadPhotosAction");

  function switchView(view) {
    const stats = view === "stats";
    photosView.hidden = stats;
    statsView.hidden = !stats;
    pageTitle.textContent = stats ? "Website Stats" : "Project Photos";
    pageEyebrow.textContent = stats ? "WEBSITE ANALYTICS" : "WEBSITE CONTENT";
    uploadPhotosAction.hidden = stats;
    document.querySelectorAll(".side-nav button").forEach(button => {
      const active = stats ? button.dataset.view === "stats" : button.dataset.scroll === "photosSection";
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#sidebar")?.classList.remove("open");
    $("#sidebarBackdrop")?.classList.remove("show");
    window.scrollTo({ top: 0, behavior: "instant" });
    updateScrollTopButton();
    if (stats) loadWebsiteStats();
  }

  document.querySelector('[data-view="stats"]')?.addEventListener("click", () => switchView("stats"));
  document.querySelector('[data-scroll="photosSection"]')?.addEventListener("click", () => switchView("photos"));

  document
    .querySelectorAll(
      "[data-scroll]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          document
            .getElementById(
              button.dataset.scroll
            )
            ?.scrollIntoView({
              behavior:
                "smooth",

              block:
                "start"
            });

          $("#sidebar")
            ?.classList
            .remove("open");

          $("#sidebarBackdrop")
            ?.classList
            .remove("show");
        }
      );
    });

  const scrollTopButton =
    $("#scrollTopButton");

  function updateScrollTopButton() {
    if (!scrollTopButton) {
      return;
    }

    const scrollY =
      window.scrollY ||
      document.documentElement
        .scrollTop ||
      0;

    const shouldShow =
      scrollY > 180 &&
      !appView.hidden;

    scrollTopButton.hidden =
      false;

    scrollTopButton
      .classList
      .toggle(
        "show",
        shouldShow
      );

    scrollTopButton
      .setAttribute(
        "aria-hidden",
        shouldShow
          ? "false"
          : "true"
      );
  }

  scrollTopButton
    ?.addEventListener(
      "click",
      () => {
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      }
    );

  window.addEventListener(
    "scroll",
    updateScrollTopButton,
    {
      passive: true
    }
  );

  window.addEventListener(
    "resize",
    updateScrollTopButton
  );

  window.requestAnimationFrame(
    updateScrollTopButton
  );

  client.auth.onAuthStateChange(
    (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveringPassword = true;
        showPasswordReset();
        return;
      }
      // Defer database/auth calls until the Supabase auth callback releases its lock.
      if (event === "SIGNED_IN" && session && !recoveringPassword && appView.hidden) {
        setTimeout(() => enterApp(session), 0);
      }
      if (
        event === "SIGNED_OUT"
      ) {
        appSessionUserId =
          null;

        photos = [];

        showLogin();

        return;
      }

      if (session?.user) {
        appSessionUserId =
          session.user.id;
      }
    }
  );

  (async function boot() {
    const savedEmail =
      window.localStorage.getItem(
        SAVED_EMAIL_KEY
      );

    if (savedEmail) {
      emailInput.value =
        savedEmail;

      saveEmailCheckbox.checked =
        true;
    } else {
      saveEmailCheckbox.checked =
        false;
    }

    try {
      const {
        data,
        error
      } =
        await client.auth
          .getSession();

      if (error) {
        throw error;
      }

      if (callbackError) {
        recoveringPassword = false;
        window.history.replaceState({}, "", window.location.pathname);
        showLogin(callbackError);
        return;
      }

      if (
        data.session?.user
      ) {
        appSessionUserId =
          data.session.user.id;

        await enterApp(
          data.session
        );

        return;
      }

      if (recoveringPassword || callbackError) {
        recoveringPassword = false;
        window.history.replaceState({}, "", window.location.pathname);
        showLogin(callbackError || "This password reset link is invalid or expired. Request a new link.");
      } else {
        showLogin();
      }
    } catch (error) {
      console.error(
        "Could not restore saved login session:",
        error
      );

      showLogin();
    }
  })();
})();
