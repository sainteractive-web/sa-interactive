document.documentElement.classList.add("js");

const menuButton = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector(".primary-nav");

if (menuButton && primaryNav) {
  const closeMenu = () => {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    primaryNav.classList.remove("is-open");
  };

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
    primaryNav.classList.toggle("is-open", !isOpen);
  });

  primaryNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

const year = document.querySelector("#year");
if (year) year.textContent = String(new Date().getFullYear());

const contactForm = document.querySelector("#contact-form");
const formNote = document.querySelector("#form-note");

function initializeSupabaseClient() {
  const config = window.SA_SUPABASE_CONFIG ?? {};
  const projectUrl = typeof config.projectUrl === "string" ? config.projectUrl.trim() : "";
  const publishableKey = typeof config.publishableKey === "string" ? config.publishableKey.trim() : "";

  if (!projectUrl || !publishableKey) return { status: "missing-config", client: null };
  if (!window.supabase?.createClient) return { status: "sdk-unavailable", client: null };
  if (!publishableKey.startsWith("sb_publishable_")) return { status: "invalid-key", client: null };

  try {
    const parsedUrl = new URL(projectUrl);
    if (parsedUrl.protocol !== "https:") return { status: "invalid-url", client: null };

    return {
      status: "initialized",
      client: window.supabase.createClient(projectUrl, publishableKey),
    };
  } catch {
    return { status: "initialization-error", client: null };
  }
}

let supabaseSetup = initializeSupabaseClient();
window.saSupabaseClient = supabaseSetup.client;

const supabaseSdk = document.querySelector("#supabase-sdk");
const supabaseReady = supabaseSetup.status === "sdk-unavailable" && supabaseSdk
  ? new Promise((resolve) => {
      const finish = () => {
        supabaseSetup = initializeSupabaseClient();
        window.saSupabaseClient = supabaseSetup.client;
        resolve(supabaseSetup);
      };
      supabaseSdk.addEventListener("load", finish, { once: true });
      supabaseSdk.addEventListener("error", finish, { once: true });
      if (window.supabase?.createClient) finish();
    })
  : Promise.resolve(supabaseSetup);

if (contactForm && formNote) {
  const submitButton = contactForm.querySelector('button[type="submit"]');
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let isSubmitting = false;

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSubmitting) return;

    const activeSupabaseSetup = await supabaseReady;

    const setupMessages = {
      "missing-config": "Add your Supabase Project URL and Publishable Key in scripts/supabase-config.js before connecting this form.",
      "sdk-unavailable": "The Supabase client could not be loaded. Check your network connection and try again.",
      "invalid-key": "Supabase needs a Publishable Key that starts with sb_publishable_. Check scripts/supabase-config.js.",
      "invalid-url": "The Supabase Project URL must use HTTPS. Check scripts/supabase-config.js.",
      "initialization-error": "Supabase could not be initialized. Check the Project URL and Publishable Key.",
    };

    if (activeSupabaseSetup.status !== "initialized") {
      formNote.textContent = setupMessages[activeSupabaseSetup.status] ?? "Supabase is not ready. Check the connection settings.";
      return;
    }

    const formData = new FormData(contactForm);
    const submission = {
      id: crypto.randomUUID(),
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      project: String(formData.get("project") ?? "").trim(),
    };

    if (submission.name.length < 1 || submission.name.length > 120) {
      formNote.textContent = "Please enter a name of 1 to 120 characters.";
      return;
    }
    if (submission.email.length > 254 || !emailPattern.test(submission.email)) {
      formNote.textContent = "Please enter a valid email address.";
      return;
    }
    if (submission.project.length < 1 || submission.project.length > 5000) {
      formNote.textContent = "Please enter a project message of 1 to 5000 characters.";
      return;
    }

    isSubmitting = true;
    if (submitButton) submitButton.disabled = true;
    formNote.textContent = "Sending your message…";

    try {
      const { error } = await window.saSupabaseClient
        .from("contact_submissions")
        .insert(submission);

      if (error) throw error;

      let emailNotificationFailed = false;
      try {
        const { error: notificationError } = await window.saSupabaseClient.functions.invoke(
          "contact-notification",
          { body: { id: submission.id } },
        );
        emailNotificationFailed = Boolean(notificationError);
      } catch {
        emailNotificationFailed = true;
      }

      contactForm.reset();
      formNote.textContent = emailNotificationFailed
        ? "Your message was saved, but the studio email alert could not be sent. Please contact us directly if this is urgent."
        : "Your message has been sent. Thank you.";
    } catch (error) {
      console.error("[SA Interactive] Contact submission failed.", error?.code ?? "unknown error");
      const submissionErrors = {
        "42501": "The database is not allowing this submission yet. Please contact us another way while we resolve the form setup.",
        "23514": "Please check your name, email address, and project message, then try again.",
        "PGRST205": "The contact form table is not available through the Supabase Data API yet. Please try again later.",
      };
      formNote.textContent = submissionErrors[error?.code]
        ?? (error instanceof TypeError
          ? "We couldn’t reach the form service. Check your internet connection and try again."
          : "We couldn’t save your message. Please try again in a moment.");
    } finally {
      isSubmitting = false;
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function initHeroFilm() {
  const hero = document.querySelector(".hero");
  const field = document.querySelector(".fragment-field");
  const monogram = document.querySelector(".monogram-frame");
  const content = document.querySelector(".hero-content");

  if (!hero || !field || !monogram || !content) return;

  // Fail into the existing text hero if the CDN scripts cannot be loaded.
  if (!window.gsap || !window.ScrollTrigger) {
    hero.classList.add("hero-static");
    return;
  }

  // A repeated call must not create a second matchMedia context or trigger set.
  if (hero.dataset.animationInitialized === "true") return;
  hero.dataset.animationInitialized = "true";

  gsap.registerPlugin(ScrollTrigger);
  const journeyBackdrop = document.querySelector(".journey-backdrop");
  if (journeyBackdrop) {
    const ocean = journeyBackdrop.querySelector(".journey-ocean");
    const rays = journeyBackdrop.querySelector(".journey-rays");
    const particles = journeyBackdrop.querySelector(".journey-particles");
    const stars = journeyBackdrop.querySelector(".journey-stars");
    const nebula = journeyBackdrop.querySelector(".journey-nebula");
    const main = document.querySelector("main");

    if (main && ocean && rays && particles && stars && nebula) {
      const journeyMedia = gsap.matchMedia();
      journeyMedia.add(
        {
          mobile: "(max-width: 700px)",
          desktop: "(min-width: 701px)",
          motionAllowed: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          if (!context.conditions.motionAllowed) return;

          const isMobile = context.conditions.mobile;
          const journey = gsap.timeline({
            scrollTrigger: {
              trigger: main,
              start: "top top",
              end: "bottom bottom",
              scrub: isMobile ? true : 1.2,
              invalidateOnRefresh: true,
            },
          });

          if (isMobile) {
            // Stage mobile layer changes so no more than two full-screen layers
            // animate together. Direct scrubbing avoids a lingering catch-up tween.
            journey
              .to(ocean, { opacity: 0.18, duration: 0.4, ease: "none" }, 0)
              .to(rays, { opacity: 0.04, duration: 0.16, ease: "none" }, 0.4)
              .to(stars, { opacity: 0.78, duration: 0.42, ease: "none" }, 0.4)
              .to(particles, { opacity: 0.08, duration: 0.18, ease: "none" }, 0.6)
              .to(ocean, { opacity: 0, duration: 0.15, ease: "none" }, 0.82)
              .to(nebula, { opacity: 0.9, duration: 0.18, ease: "none" }, 0.82);
          } else {
            journey
              .to(ocean, { opacity: 0.18, duration: 0.72, ease: "none" }, 0)
              .to(rays, { opacity: 0.04, duration: 0.55, ease: "none" }, 0)
              .to(particles, { opacity: 0.08, duration: 0.6, ease: "none" }, 0.08)
              .to(stars, { opacity: 0.78, duration: 0.76, ease: "none" }, 0.12)
              .to(nebula, { opacity: 0.9, duration: 0.62, ease: "none" }, 0.42)
              .to(ocean, { opacity: 0, duration: 0.25, ease: "none" }, 0.72);
          }
        },
      );
    }
  }

  const palette = [
    ["#f5f3ec", "#858a90", "#45494e"],
    ["#ffe6a1", "#bd914c", "#6f5127"],
    ["#d7d8d4", "#9da0a2", "#5c6267"],
  ];

  const responsiveAnimations = gsap.matchMedia();
  responsiveAnimations.add(
    {
      desktop: "(min-width: 901px)",
      mobile: "(max-width: 900px)",
      motionAllowed: "(prefers-reduced-motion: no-preference)",
    },
    (context) => {
      if (!context.conditions.motionAllowed) {
        hero.classList.add("hero-static");
        return () => hero.classList.remove("hero-static");
      }

      const isMobile = context.conditions.mobile;
      const fragmentCount = isMobile ? 18 : 52;
      const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 68;
      hero.classList.add("hero-ready");
      hero.classList.toggle("hero-mobile", isMobile);

      for (let index = 0; index < fragmentCount; index += 1) {
        const shard = document.createElement("span");
        const tones = palette[index % palette.length];
        shard.className = "metal-fragment";
        shard.setAttribute("aria-hidden", "true");
        shard.style.setProperty("--size", `${7 + Math.random() * (isMobile ? 13 : 23)}px`);
        shard.style.setProperty("--facet-a", tones[0]);
        shard.style.setProperty("--facet-b", tones[1]);
        shard.style.setProperty("--facet-c", tones[2]);
        field.append(shard);
        gsap.set(shard, {
          x: gsap.utils.random(-118, 118),
          y: gsap.utils.random(-78, 78),
          rotation: gsap.utils.random(-35, 35),
          scale: gsap.utils.random(0.45, 1.2),
        });
      }

      if (isMobile) {
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: hero,
            start: `top top+=${headerHeight}`,
            end: "+=160%",
            pin: true,
            pinSpacing: true,
            scrub: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        timeline
          .to(monogram, { opacity: 0.28, scale: 0.9, duration: 0.9, ease: "none" }, 0)
          .to(field.children, {
            opacity: 0.78,
            x: () => gsap.utils.random(-window.innerWidth * 0.28, window.innerWidth * 0.28),
            y: () => gsap.utils.random(-window.innerHeight * 0.28, window.innerHeight * 0.28),
            rotation: () => gsap.utils.random(-120, 120),
            stagger: { each: 0.006, from: "random" },
            duration: 0.9,
            ease: "none",
          }, 0.12)
          .to(".film-instruction", { autoAlpha: 0, duration: 0.1 }, 0.76);

        const revealDuration = 0.22;
        const revealStart = Math.max(timeline.duration() - revealDuration, 0.78);
        timeline.fromTo(
          content,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: revealDuration, ease: "power1.out", immediateRender: false },
          revealStart,
        );
      } else {
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: hero,
            start: "top top+=78",
            end: "+=160%",
            scrub: 0.65,
            pin: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        timeline
          .to(monogram, { scale: 1.04, duration: 0.12, ease: "power1.out" }, 0)
          .to(monogram, { opacity: 0.2, scale: 0.82, rotation: -3, duration: 0.42, ease: "power1.inOut" }, 0.2)
          .to(field.children, {
            opacity: 0.68,
            x: (index) => {
              const direction = index % 2 ? 1 : -1;
              return direction * gsap.utils.random(140, Math.min(window.innerWidth * 0.48, 620));
            },
            y: () => gsap.utils.random(-window.innerHeight * 0.44, window.innerHeight * 0.44),
            rotation: () => gsap.utils.random(-260, 260),
            scale: () => gsap.utils.random(0.7, 1.45),
            stagger: { each: 0.006, from: "random" },
            duration: 0.7,
            ease: "power1.inOut",
          }, 0.23)
          .to(".film-instruction", { autoAlpha: 0, duration: 0.1 }, 0.72);

        const revealDuration = 0.22;
        const revealStart = Math.max(timeline.duration() - revealDuration, 0.72);
        timeline.fromTo(
          content,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: revealDuration, ease: "power1.out", immediateRender: false },
          revealStart,
        );
      }

      return () => {
        hero.classList.remove("hero-ready", "hero-mobile");
        field.replaceChildren();
      };
    },
  );

  // Refresh after late fonts and lazy images without making hero setup wait for them.
  let refreshQueued = false;
  const refreshAfterLayoutChange = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      if (hero.isConnected) ScrollTrigger.refresh();
    });
  };

  requestAnimationFrame(() => requestAnimationFrame(refreshAfterLayoutChange));
  document.fonts?.ready?.then(refreshAfterLayoutChange);
  // Page images declare intrinsic dimensions, so their load events do not need
  // to trigger a global refresh. ScrollTrigger handles viewport resizes itself.
}

initHeroFilm();
