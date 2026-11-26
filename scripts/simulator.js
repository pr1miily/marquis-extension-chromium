// 🟢 Ensure Global Toast exists even on standalone Simulator page
if (typeof window.showGlobalAlert !== 'function') {
    window.showGlobalAlert = function(title, message, type = 'info') {
        let toastEl = document.getElementById('globalToast');
        if (!toastEl) {
            // Auto-inject the HTML structure if it's missing on this page
            const container = document.createElement('div');
            container.className = 'toast-container position-fixed bottom-0 start-50 translate-middle-x p-3';
            container.style.cssText = 'z-index: 10000; margin-bottom: 20px; width: 100%; max-width: 360px;';
            container.innerHTML = `
                <div id="globalToast" class="toast border border-secondary-subtle shadow-lg rounded-4 overflow-hidden w-100" role="alert" aria-live="assertive" aria-atomic="true">
                    <div class="toast-body p-0 bg-body">
                        <div class="d-flex align-items-start p-3">
                            <div id="globalToastIconContainer" class="d-flex align-items-center justify-content-center rounded-circle flex-shrink-0 me-3 mt-1" style="width: 36px; height: 36px;">
                                <i id="globalToastIcon" class="bi fs-5"></i>
                            </div>
                            <div class="flex-grow-1">
                                <h6 id="globalToastTitle" class="mb-1 fw-bolder text-body" style="letter-spacing: -0.3px;">Alert</h6>
                                <div id="globalToastMsg" class="small text-muted fw-medium lh-sm" style="font-size: 0.8rem;"></div>
                            </div>
                            <button type="button" class="btn-close ms-2 mt-1" data-bs-dismiss="toast" aria-label="Close" style="font-size: 12px;"></button>
                        </div>
                        <div class="progress bg-transparent" style="height: 3px;">
                            <div id="globalToastProgressBar" class="progress-bar" role="progressbar" style="width: 100%;"></div>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(container);
            toastEl = document.getElementById('globalToast');
        }

        if (typeof bootstrap === 'undefined') return console.warn(`[Simulator Alert Fallback] ${title}\n${message}`);

        const toastTitle = document.getElementById('globalToastTitle');
        const toastMsg = document.getElementById('globalToastMsg');
        const toastIcon = document.getElementById('globalToastIcon');
        const iconContainer = document.getElementById('globalToastIconContainer');
        const progressBar = document.getElementById('globalToastProgressBar');

        toastTitle.innerText = title;
        toastMsg.innerText = message;

        iconContainer.className = 'd-flex align-items-center justify-content-center rounded-circle flex-shrink-0 me-3 mt-1 ';
        toastIcon.className = 'bi fs-5 ';
        progressBar.className = 'progress-bar ';

        if (type === 'success') {
            iconContainer.classList.add('bg-success', 'bg-opacity-10', 'text-success');
            toastIcon.classList.add('bi-check-circle-fill');
            progressBar.classList.add('bg-success');
        } else if (type === 'error' || type === 'danger') {
            iconContainer.classList.add('bg-danger', 'bg-opacity-10', 'text-danger');
            toastIcon.classList.add('bi-exclamation-triangle-fill');
            progressBar.classList.add('bg-danger');
        } else if (type === 'warning') {
            iconContainer.classList.add('bg-warning', 'bg-opacity-10', 'text-warning-emphasis');
            toastIcon.classList.add('bi-exclamation-circle-fill');
            progressBar.classList.add('bg-warning');
        } else {
            iconContainer.classList.add('bg-primary', 'bg-opacity-10', 'text-primary');
            toastIcon.classList.add('bi-info-circle-fill');
            progressBar.classList.add('bg-primary');
        }

        const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
        toast.show();

        progressBar.style.transition = 'none';
        progressBar.style.width = '100%';
        setTimeout(() => {
            progressBar.style.transition = 'width 4s linear';
            progressBar.style.width = '0%';
        }, 50);
    };
}

// 🟢 SECURITY GATEKEEPER
const isRestrictedUrl = (url) => {
    if (!url) return true;
    const prefixes = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'moz-extension://'];
    const domains = ['chrome.google.com/webstore', 'chromewebstore.google.com'];
    return prefixes.some(p => url.startsWith(p)) || domains.some(d => url.includes(d));
};


// ============================================================
// 🔍 LAYOUT DETECTION ENGINE
// Modular, cross-origin-safe, device-context-aware
// ============================================================

const LayoutDetector = {
    tabId: null,
    frameId: null,
    issues: [],

    init() {
        chrome.tabs.getCurrent(tab => { this.tabId = tab?.id; });
    },

    async resolveFrameId(url) {
        if (!this.tabId) return null;
        return new Promise(resolve => {
            chrome.webNavigation.getAllFrames({ tabId: this.tabId }, frames => {
                if (!frames?.length) return resolve(null);
                // Prefer exact URL match; fall back to first non-top frame
                const match = frames.find(f => f.url === url)
                           || frames.find(f => f.frameId !== 0);
                resolve(match?.frameId ?? null);
            });
        });
    },

    // Returns safe-area insets for the given device preset
    getSafeArea(notch, os, type) {
        if (type === 'desktop' || type === 'watch') return { safeTop: 0, safeBottom: 0 };
        if (os === 'ios') {
            if (notch === 'notch-dynamic')  return { safeTop: 59, safeBottom: 34 };
            if (notch === 'notch-standard') return { safeTop: 44, safeBottom: 34 };
            if (notch === 'notch-classic')  return { safeTop: 20, safeBottom: 0  };
            return { safeTop: 24, safeBottom: 34 };
        }
        if (os === 'android') return { safeTop: 28, safeBottom: 0 };
        return { safeTop: 0, safeBottom: 0 };
    },

    async detect(deviceCtx) {
        this.frameId = await this.resolveFrameId(deviceCtx.url);
        if (!this.frameId) return null;
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: this.tabId, frameIds: [this.frameId] },
                func: _runAllDetectors,
                args: [deviceCtx]
            });
            return results?.[0]?.result ?? [];
        } catch (err) {
            console.warn('[LayoutDetector] Injection failed (cross-origin?):', err);
            return null;
        }
    },

    async highlightIssue(issue) {
        if (!this.frameId || !issue) return;
        try {
            await chrome.scripting.executeScript({
                target: { tabId: this.tabId, frameIds: [this.frameId] },
                func: _injectHighlight,
                args: [issue]
            });
        } catch (e) {}
    },

    async clearHighlights() {
        if (!this.frameId) return;
        try {
            await chrome.scripting.executeScript({
                target: { tabId: this.tabId, frameIds: [this.frameId] },
                func: () => { document.getElementById('_mqQaHighlightRoot')?.remove(); }
            });
        } catch (e) {}
    }
};

// ── These functions execute INSIDE the iframe (no outer-scope access) ────────

function _runAllDetectors(ctx) {
    const issues = [];

    function sel(el) {
        if (el.id) return `#${el.id}`;
        const cls = typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).filter(c => /^[a-z]/i.test(c) && c.length < 25).slice(0, 2).join('.')
            : '';
        return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
    }

    function visible(query = '*') {
        return Array.from(document.querySelectorAll(query)).filter(el => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0;
        });
    }

    function rect(el) {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
    }

    const vw = ctx.width, vh = ctx.height;

    // ── 1. HORIZONTAL OVERFLOW ──────────────────────────────────────────────
    (function detectOverflow() {
        if (document.documentElement.scrollWidth > vw + 2) {
            issues.push({
                type: 'overflow', severity: 'error',
                title: 'Page has horizontal overflow',
                description: `Page content is ${document.documentElement.scrollWidth}px wide inside a ${vw}px viewport — causing unwanted horizontal scrolling.`,
                selector: 'html',
                fix: 'Find elements wider than the viewport. Add `max-width: 100%; overflow-x: hidden` to body, and replace fixed widths with fluid units.',
                rect: null
            });
        }
        let found = 0;
        for (const el of visible()) {
            const r = el.getBoundingClientRect();
            if (r.width < 2) continue;
            if (r.right > vw + 5) {
                const overshoot = Math.round(r.right - vw);
                issues.push({
                    type: 'overflow', severity: overshoot > 30 ? 'error' : 'warning',
                    title: `Element bleeds ${overshoot}px past right edge`,
                    description: `<${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 50)}" extends to x=${Math.round(r.right)} in a ${vw}px viewport.`,
                    selector: sel(el), fix: 'Apply `max-width: 100%; box-sizing: border-box` or switch to fluid/percentage widths.',
                    rect: rect(el)
                });
                if (++found >= 6) break;
            }
        }
    })();

    // ── 2. ELEMENTS OUTSIDE VIEWPORT ───────────────────────────────────────
    (function detectOutOfViewport() {
        let found = 0;
        for (const el of visible()) {
            const r = el.getBoundingClientRect();
            if (r.width < 5 || r.height < 5) continue;
            if (r.right < -10 || r.left > vw + 10 || r.bottom < -10 || r.top > vh + 10) {
                issues.push({
                    type: 'outOfBounds', severity: 'warning',
                    title: 'Element positioned outside viewport',
                    description: `<${el.tagName.toLowerCase()}> is at (${Math.round(r.left)}, ${Math.round(r.top)}) — fully outside the ${vw}×${vh} viewport and invisible to users.`,
                    selector: sel(el), fix: 'Use relative/percentage-based positioning or add `overflow: hidden` to the parent container.',
                    rect: rect(el)
                });
                if (++found >= 4) break;
            }
        }
    })();

    // ── 3. TEXT CLIPPING ───────────────────────────────────────────────────
    (function detectTextClipping() {
        let found = 0;
        for (const el of visible('p,h1,h2,h3,h4,h5,h6,span,a,button,label,li,td,th,div')) {
            const s = window.getComputedStyle(el);
            if ((s.overflow === 'hidden' || s.overflowY === 'hidden') && el.scrollHeight > el.clientHeight + 12 && el.clientHeight > 10) {
                issues.push({
                    type: 'textClipping', severity: 'warning',
                    title: `Content clipped — ${el.scrollHeight - el.clientHeight}px hidden by overflow:hidden`,
                    description: `<${el.tagName.toLowerCase()}> content is ${el.scrollHeight}px tall but the box is only ${el.clientHeight}px — ${el.scrollHeight - el.clientHeight}px is invisible.`,
                    selector: sel(el), fix: 'Remove `overflow: hidden`, increase `min-height`, or switch to `overflow: auto` to let content breathe.',
                    rect: rect(el)
                });
                if (++found >= 5) break;
            }
            if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 2) {
                issues.push({
                    type: 'textClipping', severity: 'info',
                    title: 'Text truncated with ellipsis on this device',
                    description: `"${(el.textContent || '').trim().slice(0, 60)}" is cut off (${el.scrollWidth}px of text in a ${el.clientWidth}px container) at ${vw}px viewport.`,
                    selector: sel(el), fix: 'Allow text wrapping at this breakpoint, widen the container, or reduce font size via media query.',
                    rect: rect(el)
                });
                if (++found >= 5) break;
            }
        }
    })();

    // ── 4. FIXED / STICKY ISSUES ───────────────────────────────────────────
    (function detectFixedSticky() {
        const pinned = Array.from(document.querySelectorAll('*')).filter(el => {
            const p = window.getComputedStyle(el).position;
            return p === 'fixed' || p === 'sticky';
        });
        let totalH = 0;
        for (const el of pinned) {
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 5) continue;
            const pct = Math.round(r.height / vh * 100);
            if (pct > 25) {
                issues.push({
                    type: 'fixedSticky', severity: 'warning',
                    title: `${window.getComputedStyle(el).position} element occupies ${pct}% of viewport height`,
                    description: `${sel(el)} is ${Math.round(r.height)}px tall — a persistent UI element consuming ${pct}% of the ${vh}px screen height.`,
                    selector: sel(el), fix: 'Set `max-height` as a viewport percentage, or collapse/hide with a media query on smaller devices.',
                    rect: rect(el)
                });
            }
            if (r.top >= 0 && r.top < vh) totalH += r.height;
        }
        if (totalH > vh * 0.4) {
            issues.push({
                type: 'fixedSticky', severity: 'error',
                title: `Pinned UI consumes ${Math.round(totalH / vh * 100)}% of screen height`,
                description: `Fixed and sticky elements together occupy ${Math.round(totalH)}px of a ${vh}px viewport — only ${Math.round(vh - totalH)}px remains for page content.`,
                selector: 'fixed/sticky elements combined', fix: 'Collapse navigation into a hamburger menu, reduce sticky header padding, or eliminate redundant pinned bars on mobile.',
                rect: null
            });
        }
    })();

    // ── 5. NOTCH / SAFE AREA OCCLUSION ─────────────────────────────────────
    (function detectNotchOcclusion() {
        if (!ctx.safeTop && !ctx.safeBottom) return;
        let found = 0;
        for (const el of visible('button,a,input,select,h1,h2,nav,header,[role="button"]')) {
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            if (ctx.safeTop && r.top < ctx.safeTop && r.bottom > 0) {
                issues.push({
                    type: 'notchOcclusion', severity: 'error',
                    title: 'Element hidden behind notch / status bar',
                    description: `${sel(el)} starts at y=${Math.round(r.top)}px — inside the ${ctx.safeTop}px top safe area. It may be partially or fully invisible.`,
                    selector: sel(el), fix: 'Add `padding-top: env(safe-area-inset-top)` to the page wrapper or fixed container.',
                    rect: rect(el)
                });
                if (++found >= 4) break;
            }
            if (ctx.safeBottom && r.bottom > vh - ctx.safeBottom && r.top < vh) {
                issues.push({
                    type: 'notchOcclusion', severity: 'warning',
                    title: 'Element overlaps home indicator zone',
                    description: `${sel(el)} bottom is at y=${Math.round(r.bottom)}px, overlapping the ${ctx.safeBottom}px bottom safe area on this device.`,
                    selector: sel(el), fix: 'Add `padding-bottom: env(safe-area-inset-bottom)` to the bottom container.',
                    rect: rect(el)
                });
                if (++found >= 4) break;
            }
        }
    })();

    // ── 6. SMALL TAP TARGETS ───────────────────────────────────────────────
    (function detectTapTargets() {
        if (ctx.type === 'desktop') return;
        const min = 44; // Apple HIG + Material Design minimum
        let found = 0;
        for (const el of visible('button,a,input,select,[role="button"]')) {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.width < min || r.height < min) {
                const label = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 40) || sel(el);
                issues.push({
                    type: 'tapTarget', severity: 'warning',
                    title: `Tap target too small — ${Math.round(r.width)}×${Math.round(r.height)}px`,
                    description: `"${label}" is below the ${min}px minimum touch target recommended by Apple HIG and Material Design.`,
                    selector: sel(el), fix: `Add padding to inflate the tap area: \`min-height: ${min}px; min-width: ${min}px\` or \`padding: 12px 16px\`.`,
                    rect: rect(el)
                });
                if (++found >= 5) break;
            }
        }
    })();

    // ── 7. OVERLAP — positioned elements obscuring interactive controls ─────
    (function detectOverlap() {
        const overlayers = Array.from(document.querySelectorAll('*')).filter(el => {
            const p = window.getComputedStyle(el).position;
            return (p === 'fixed' || p === 'absolute') && el.getBoundingClientRect().width > 30;
        }).slice(0, 40);

        let found = 0;
        const flaggedTargets = new Set(); // 🟢 NEW: Memory bank to prevent redundant complaints

        for (const layer of overlayers) {
            const lr = layer.getBoundingClientRect();
            if (lr.width < 5 || lr.height < 5) continue;
            for (const target of visible('button,a,input,select').slice(0, 60)) {
                if (layer === target || layer.contains(target) || target.contains(layer)) continue;
                if (flaggedTargets.has(target)) continue; // 🟢 NEW: Skip if already flagged
                
                const tr = target.getBoundingClientRect();
                if (tr.width < 2 || tr.height < 2) continue;
                const overlaps = lr.left < tr.right + 1 && lr.right > tr.left - 1 && lr.top < tr.bottom + 1 && lr.bottom > tr.top - 1;
                if (overlaps) {
                    const lz = parseInt(window.getComputedStyle(layer).zIndex) || 0;
                    const tz = parseInt(window.getComputedStyle(target).zIndex) || 0;
                    if (lz >= tz) {
                        flaggedTargets.add(target); // 🟢 NEW: Mark as flagged
                        issues.push({
                            type: 'overlap', severity: 'error',
                            title: 'Interactive element is obscured by overlay',
                            description: `${sel(target)} is covered by ${sel(layer)} (z-index ${lz}), making it unreachable to users.`,
                            selector: sel(target), fix: `Raise the interactive element's z-index, adjust the overlay's dimensions, or apply \`pointer-events: none\` to the covering layer.`,
                            rect: rect(target)
                        });
                        if (++found >= 3) return;
                    }
                }
            }
        }
    })();

    // ── 8. ILLEGIBLE FONT SIZES (Mobile Accessibility) ─────────────────────
    (function detectTinyText() {
        if (ctx.type === 'desktop') return; // Mostly a mobile issue
        let found = 0;
        for (const el of visible('p, span, a, button, li, label, th, td')) {
            if (!el.innerText.trim()) continue; // Skip empty elements
            const style = window.getComputedStyle(el);
            const size = parseFloat(style.fontSize);
            if (size > 0 && size < 12) {
                issues.push({
                    type: 'tinyText', severity: 'warning',
                    title: `Text is too small for mobile screens (${Math.round(size)}px)`,
                    description: `"${(el.textContent || '').trim().slice(0, 45)}..." is rendered at ${Math.round(size)}px, which is below the 12px minimum legibility threshold.`,
                    selector: sel(el), fix: 'Increase font-size to at least 12px (16px is recommended for body text) to ensure comfortable reading on mobile devices.',
                    rect: rect(el)
                });
                if (++found >= 4) break;
            }
        }
    })();

    // ── 9. IOS AUTO-ZOOM BUG (Inputs < 16px) ───────────────────────────────
    (function detectIOSInputZoom() {
        if (ctx.os !== 'ios' || ctx.type === 'desktop') return;
        let found = 0;
        for (const el of visible('input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="search"], input[type="tel"], textarea, select')) {
            const style = window.getComputedStyle(el);
            const size = parseFloat(style.fontSize);
            if (size > 0 && size < 16) {
                issues.push({
                    type: 'iosZoom', severity: 'warning',
                    title: `Input triggers forced iOS Safari Zoom (${Math.round(size)}px)`,
                    description: `Form input uses a font size of ${Math.round(size)}px. iOS Safari automatically zooms the screen in when users focus on inputs smaller than 16px, breaking the layout.`,
                    selector: sel(el), fix: 'Set the input `font-size` to at least 16px to prevent forced zooming, or apply `maximum-scale=1` to the viewport meta tag (though the latter harms accessibility).',
                    rect: rect(el)
                });
                if (++found >= 3) break;
            }
        }
    })();

    // ── 10. GHOST INTERACTIONS (Empty Buttons/Links) ───────────────────────
    (function detectEmptyInteractive() {
        let found = 0;
        for (const el of visible('button, a')) {
            const hasText = !!el.innerText.trim();
            const hasAria = !!el.getAttribute('aria-label') || !!el.getAttribute('title');
            const hasImage = !!el.querySelector('img, svg, i');
            
            if (!hasText && !hasAria && !hasImage) {
                issues.push({
                    type: 'emptyInteractive', severity: 'warning',
                    title: `Empty interactive element detected`,
                    description: `<${el.tagName.toLowerCase()}> occupies layout space but has no visible text, icon, or screen-reader label.`,
                    selector: sel(el), fix: 'Add inner text, inject an SVG/icon, or provide an `aria-label` attribute so users and screen readers know its purpose.',
                    rect: rect(el)
                });
                if (++found >= 4) break;
            }
        }
    })();

    // ── 11. UNCONSTRAINED MEDIA ────────────────────────────────────────────
    (function detectUnconstrainedMedia() {
        let found = 0;
        for (const el of visible('img, video, iframe')) {
            const r = el.getBoundingClientRect();
            if (r.width > vw + 10) {
                const style = window.getComputedStyle(el);
                if (style.maxWidth !== '100%') {
                    issues.push({
                        type: 'unconstrainedMedia', severity: 'error',
                        title: `Media element breaks viewport width`,
                        description: `<${el.tagName.toLowerCase()}> is ${Math.round(r.width)}px wide inside a ${vw}px viewport because it lacks responsive constraints.`,
                        selector: sel(el), fix: 'Add `max-width: 100%; height: auto;` to ensure images and videos scale down elegantly to fit their containers.',
                        rect: rect(el)
                    });
                    if (++found >= 3) break;
                }
            }
        }
    })();

    // ── 12. ASPECT RATIO DISTORTION (The Aesthete) ─────────────────────────
    (function detectDistortedImages() {
        let found = 0;
        for (const img of visible('img')) {
            if (!img.naturalWidth || !img.naturalHeight || img.width === 0 || img.height === 0) continue;
            const natRatio = img.naturalWidth / img.naturalHeight;
            const renRatio = img.width / img.height;
            
            // Allow a 5% margin of error for rounding/sub-pixel rendering
            if (Math.abs(natRatio - renRatio) / natRatio > 0.05) {
                issues.push({
                    type: 'distortedImage', severity: 'warning',
                    title: `Image aspect ratio is painfully distorted`,
                    description: `An image with a natural aspect ratio of ${natRatio.toFixed(2)} is being forced to render at ${renRatio.toFixed(2)} (${Math.round(img.width)}x${Math.round(img.height)}px). It appears stretched or squished.`,
                    selector: sel(img), fix: 'Use `object-fit: cover;` or `object-fit: contain;` to preserve the image\'s natural proportions within its container.',
                    rect: rect(img)
                });
                if (++found >= 3) break;
            }
        }
    })();

    // ── 13. FAT-FINGER PROXIMITY (The Tactician) ───────────────────────────
    (function detectFatFinger() {
        if (ctx.type === 'desktop') return; // Exclusively a touch-device concern
        let found = 0;
        const interactives = visible('button, a, [role="button"], select');
        
        for (let i = 0; i < interactives.length; i++) {
            const r1 = interactives[i].getBoundingClientRect();
            if (r1.width === 0 || r1.height === 0) continue;
            
            for (let j = i + 1; j < interactives.length; j++) {
                const r2 = interactives[j].getBoundingClientRect();
                
                // Skip if they are parents/children of one another
                if (interactives[i].contains(interactives[j]) || interactives[j].contains(interactives[i])) continue;

                // Calculate the absolute gap between the two bounding boxes
                const verticalGap = Math.max(0, Math.max(r1.top - r2.bottom, r2.top - r1.bottom));
                const horizontalGap = Math.max(0, Math.max(r1.left - r2.right, r2.left - r1.right));

                // If they are dangerously close (< 8px gap) but not overlapping
                if (verticalGap < 8 && horizontalGap < 8 && (verticalGap > 0 || horizontalGap > 0)) {
                    issues.push({
                        type: 'fatFinger', severity: 'warning',
                        title: `Touch targets are uncomfortably close`,
                        description: `${sel(interactives[i])} and ${sel(interactives[j])} are less than 8px apart. Mobile users are likely to tap the wrong element.`,
                        selector: `${sel(interactives[i])}, ${sel(interactives[j])}`, 
                        fix: 'Increase the `margin` between these interactive elements to ensure a minimum safe distance for human fingers.',
                        rect: rect(interactives[i]) // Highlight the first offending element
                    });
                    if (++found >= 3) return;
                }
            }
        }
    })();

    // ── 14. Z-INDEX MEGALOMANIA (The Aristocrat) ───────────────────────────
    (function detectZIndexAbuse() {
        let found = 0;
        for (const el of visible('*')) {
            const zStr = window.getComputedStyle(el).zIndex;
            if (zStr === 'auto') continue;
            
            const z = parseInt(zStr);
            if (z > 9999) { // Flag absurdly high z-indexes
                issues.push({
                    type: 'zIndexAbuse', severity: 'info',
                    title: `Absurdly high z-index detected (${z})`,
                    description: `<${el.tagName.toLowerCase()}> is utilizing a z-index of ${z}. This suggests a desperate lack of proper stacking context management.`,
                    selector: sel(el), fix: 'Establish a proper Stacking Context using a formalized z-index scale (e.g., 10, 20, 30) rather than relying on arbitrary, astronomical numbers.',
                    rect: rect(el)
                });
                if (++found >= 3) break;
            }
        }
    })();

    // ── 15. AUTOPLAY VIOLATIONS (The Rule Enforcer) ────────────────────────
    (function detectAutoplayViolations() {
        let found = 0;
        for (const vid of visible('video[autoplay]')) {
            if (!vid.hasAttribute('muted')) {
                issues.push({
                    type: 'mediaAutoplay', severity: 'error',
                    title: `Video attempts illegal autoplay without mute`,
                    description: `A <video> element is set to \`autoplay\` but lacks the \`muted\` attribute. Modern browsers will strictly block this media from playing to prevent sudden noise.`,
                    selector: sel(vid), fix: 'Add the `muted` attribute to the video tag. If audio is required, playback must be initiated by a direct user interaction (like a click event).',
                    rect: rect(vid)
                });
                if (++found >= 2) break;
            }
        }
    })();

    // ── 16. RECKLESS EXTERNAL LINKS (The Diplomat) ─────────────────────────
    (function detectRecklessLinks() {
        let found = 0;
        for (const a of visible('a[target="_blank"]')) {
            const rel = a.getAttribute('rel') || '';
            if (!rel.toLowerCase().includes('noopener')) {
                issues.push({
                    type: 'recklessLink', severity: 'warning',
                    title: `Reckless external link vulnerability`,
                    description: `A link opening in a new tab (\`target="_blank"\`) lacks the \`rel="noopener"\` attribute, exposing the origin page to performance drains and potential security hijacking.`,
                    selector: sel(a), fix: 'Add `rel="noopener noreferrer"` to all external links opening in new tabs.',
                    rect: rect(a)
                });
                if (++found >= 3) break;
            }
        }
    })();

    // ── 17. ORPHANED INPUTS (The Interrogator) ─────────────────────────────
    (function detectOrphanedInputs() {
        let found = 0;
        for (const el of visible('input:not([type="submit"]):not([type="button"]):not([type="hidden"]), textarea, select')) {
            const id = el.id;
            const hasLabel = id ? document.querySelector(`label[for="${id}"]`) : false;
            const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
            const isWrapped = el.closest('label');
            const hasTitle = el.getAttribute('title');

            if (!hasLabel && !hasAria && !isWrapped && !hasTitle) {
                issues.push({
                    type: 'orphanedInput', severity: 'error',
                    title: `Orphaned form input lacks context`,
                    description: `An input field exists without a programmatically associated <label>, \`aria-label\`, or \`title\`. This leaves screen readers blind and users guessing.`,
                    selector: sel(el), fix: 'Provide a `<label for="inputId">` or wrap the input inside a `<label>` tag to ensure accessibility compliance.',
                    rect: rect(el)
                });
                if (++found >= 3) break;
            }
        }
    })();

    // ── 18. ARCHAIC HTML (The Historian) ───────────────────────────────────
    (function detectArchaicHTML() {
        let found = 0;
        for (const el of visible('center, font, marquee, blink, strike, b, i')) {
            issues.push({
                type: 'archaicHtml', severity: 'info',
                title: `Archaic HTML element in use (<${el.tagName.toLowerCase()}>)`,
                description: `The <${el.tagName.toLowerCase()}> tag is a relic of a bygone era. It is deprecated and presents a severe lack of separation between structure and presentation.`,
                selector: sel(el), fix: 'Replace presentational tags with semantic HTML5 elements (e.g., `<strong>` instead of `<b>`, `<em>` instead of `<i>`) or use CSS for styling.',
                rect: rect(el)
            });
            if (++found >= 3) break;
        }
    })();

    // ── 19. SEMANTIC ANARCHY (The Sovereign) ───────────────────────────────
    (function detectMultipleH1() {
        const h1s = visible('h1');
        if (h1s.length > 1) {
            issues.push({
                type: 'semanticAnarchy', severity: 'warning',
                title: `Semantic anarchy: ${h1s.length} primary headings (H1) detected`,
                description: `A page should possess a single, ruling <h1> tag to establish its primary topic. Finding ${h1s.length} indicates a fractured document outline that harms SEO and accessibility.`,
                selector: sel(h1s[1]), // Point to the second one as the usurper
                fix: 'Retain only one <h1> element for the page title. Demote the others to <h2> or <h3> to maintain a logical structural hierarchy.',
                rect: rect(h1s[1]) 
            });
        }
    })();

    return issues;
}

function _injectHighlight(issue) {
    document.getElementById('_mqQaHighlightRoot')?.remove();
    if (!issue) return;

    let target = null;
    try { target = issue.selector ? document.querySelector(issue.selector) : null; } catch(e) {}
    
    // 🟢 FIX 1: Stop the "smooth" scrolling! 
    // It captures coordinates mid-flight, causing the label and box to detach.
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'center' });

    // Re-read live rect
    const r = (() => {
        if (target) { const lr = target.getBoundingClientRect(); return { top: Math.round(lr.top), left: Math.round(lr.left), width: Math.round(lr.width), height: Math.round(lr.height) }; }
        return issue.rect;
    })();
    if (!r) return;

    const colors = { error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    const c = colors[issue.severity] || '#3b82f6';
    const sevEmoji = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';

    const bw = Math.max(r.width, 6), bh = Math.max(r.height, 6);
    const vw = window.innerWidth, vh = window.innerHeight;

    // 🟢 FIX 2: Inject reliable CSS keyframes and Arrow Connectors
    if (!document.getElementById('_mqQaStyle')) {
        const s = document.createElement('style');
        s.id = '_mqQaStyle';
        s.textContent = `
            @keyframes _mqPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
            @keyframes _mqFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
            ._mq-connector-down::after { content:''; position:absolute; top:100%; left:12px; border-width:6px; border-style:solid; border-color: var(--mq-color) transparent transparent transparent; }
            ._mq-connector-up::after { content:''; position:absolute; bottom:100%; left:12px; border-width:6px; border-style:solid; border-color: transparent transparent var(--mq-color) transparent; }
        `;
        document.head.appendChild(s);
    }

    const root = document.createElement('div');
    root.id = '_mqQaHighlightRoot';
    root.style.cssText = `position:fixed; inset:0; pointer-events:none; z-index:2147483647; overflow:visible; --mq-color: ${c};`;

    // 🟢 FIX 3: Smart collision detection so it never blocks the box
    const labelHeight = 28; // Approximate height of the label pill
    const arrowSize = 6;
    
    // Does the label have enough room to fit ABOVE the box?
    const isAbove = r.top > (labelHeight + arrowSize + 10);

    // Position the label safely above or flip it below the target box
    const labelTop = isAbove ? (r.top - labelHeight - arrowSize) : (r.top + bh + arrowSize);
    const connectorClass = isAbove ? '_mq-connector-down' : '_mq-connector-up';

    // Keep label strictly inside the horizontal viewport so it doesn't bleed off-screen
    const estimatedWidth = Math.min(260, issue.title.slice(0, 44).length * 7 + 36);
    const labelLeft = Math.max(8, Math.min(vw - estimatedWidth - 8, r.left));

    root.innerHTML = `
        <div style="
            position:fixed; top:${r.top}px; left:${r.left}px;
            width:${bw}px; height:${bh}px;
            border: 2px solid ${c}; border-radius: 4px;
            background: ${c}15;
            box-shadow: 0 0 0 1px rgba(0,0,0,0.1), inset 0 0 0 1px ${c}40;
            animation: _mqPulse 1.5s ease infinite;
        "></div>

        <div class="${connectorClass}" style="
            position:fixed; left:${labelLeft}px; top:${labelTop}px;
            background:${c}; color:#fff; font-size:12px; font-weight:700;
            padding:5px 10px 5px 8px; border-radius:6px; white-space:nowrap;
            font-family:-apple-system,'Segoe UI',sans-serif;
            max-width:260px; overflow:hidden; text-overflow:ellipsis;
            box-shadow:0 4px 14px rgba(0,0,0,0.45);
            display:flex; align-items:center; gap:5px; letter-spacing:0.1px;
            animation: _mqFadeIn 0.2s ease-out forwards;
        ">
            ${sevEmoji} ${issue.title.slice(0, 44)}
        </div>
    `;

    document.body.appendChild(root);
    setTimeout(() => root?.remove(), 9000);
}

// ─────────────────────────────────────────────────────────────────────────────

// Sites often refuse to be framed (X-Frame-Options / CSP frame-ancestors). Strip those
// headers ONLY for frames inside this simulator tab, via a session rule keyed by tab id.
// Replaces the old static rules.json rule, which stripped them for every iframe on every site.
const simFramingReady = new Promise(resolve => chrome.tabs.getCurrent(resolve)).then(async (tab) => {
    // Top-level only: simulator.html is web-accessible, so a site could frame it to gain the rule.
    if (!tab || window.top !== window) return;
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [tab.id],
        addRules: [{
            id: tab.id,
            priority: 1,
            action: {
                type: 'modifyHeaders',
                responseHeaders: [
                    { header: 'X-Frame-Options', operation: 'remove' },
                    { header: 'Content-Security-Policy', operation: 'remove' }
                ]
            },
            condition: { tabIds: [tab.id], resourceTypes: ['sub_frame'] }
        }]
    });
    // Drop the rule when this page goes away so the tab's next page gets normal protection.
    window.addEventListener('pagehide', () => {
        chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tab.id] });
    });
}).catch(err => console.warn('[Simulator] Framing rule failed:', err));

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('simGoBtn')) return;
    // 1. Grab parameters passed from the extension
    const urlParams = new URLSearchParams(window.location.search);
    let targetUrl = urlParams.get('url') || 'https://example.com';
    let width = parseInt(urlParams.get('w')) || 390;
    let height = parseInt(urlParams.get('h')) || 844;
    // simulator.html is web-accessible, so any site can open it with its own parameters: only plain ids pass.
    const plainParam = (v, fallback) => /^[a-z0-9-]{1,24}$/i.test(v || '') ? v : fallback;
    let type = plainParam(urlParams.get('type'), 'phone');
    let notch = plainParam(urlParams.get('notch'), 'notch-dynamic');
    let os = plainParam(urlParams.get('os'), 'ios');

    // Prevent restricted URLs from loading initially
    if (isRestrictedUrl(targetUrl)) {
        targetUrl = 'https://example.com';
    }

    // 2. UI Elements
    const frame = document.getElementById('simFrame');
    const device = document.getElementById('deviceFrame');
    const urlInput = document.getElementById('simUrl');
    const goBtn = document.getElementById('simGoBtn');
    const rotateBtn = document.getElementById('simRotate');
    const nativeBtn = document.getElementById('simNativeBtn');
    const scaleSlider = document.getElementById('simScale');
    const scaleVal = document.getElementById('simScaleVal');
    const scaleContainer = document.getElementById('scaleContainer');
    
    // Select ALL chrome url displays
    const chromeUrls = document.querySelectorAll('.chrome-url');
    const deviceSelect = document.getElementById('simDeviceSelect');

    // 3. Dynamic Clock Function
    function updateDeviceTime() {
        const timeEl = document.getElementById('hwTime');
        if(timeEl) {
            const now = new Date();
            let hours = now.getHours();
            hours = hours % 12;
            hours = hours ? hours : 12; 
            const minutes = now.getMinutes().toString().padStart(2, '0');
            timeEl.innerText = `${hours}:${minutes}`;
        }
    }
    setInterval(updateDeviceTime, 1000);
    updateDeviceTime();

    // 4. Apply sizing and URL
    function applySettings() {
        frame.style.width = width + 'px';
        frame.style.height = height + 'px';
        
        // Apply Device Type, Notch Shape, AND Operating System classes
        device.className = `device-frame ${type} ${notch} os-${os}`;

        if (frame.src !== targetUrl) {
            urlInput.value = targetUrl;
            const url = targetUrl;
            // Wait for the framing rule, or the first load can be refused by X-Frame-Options.
            simFramingReady.then(() => { if (frame.src !== url) frame.src = url; });
        }

        if(chromeUrls.length > 0) {
            let displayUrl = targetUrl;
            try { displayUrl = new URL(targetUrl).hostname; } catch(e) {}
            // Update the URL in all the different OS headers
            chromeUrls.forEach(el => el.innerText = displayUrl);
        }
        
        // Sync Dropdown to current resolution
        const matchVal = `${width},${height},${type},${notch},${os}`;
        if (Array.from(deviceSelect.options).some(opt => opt.value === matchVal)) {
            deviceSelect.value = matchVal;
        } else {
            const opt = document.createElement('option');
            opt.value = matchVal;
            opt.innerText = `Custom (${width}x${height})`;
            deviceSelect.appendChild(opt);
            deviceSelect.value = matchVal;
        }
    }

	// 5. Auto-scale to fit screen
    function autoFit() {
        const availableHeight = window.innerHeight - 100; 
        const availableWidth = window.innerWidth - 100;
        
        let extraHeight = 0;
        let extraWidth = 0;

        // MATH: Dynamically calculate total extra height (Hardware Bezels + Browser UI)
        if (type === 'phone') {
            // 🟢 FIX: Account for the fat 140px bezels on classic iPhones
            extraHeight += (notch === 'notch-classic') ? 140 : 32; 
            extraWidth += 32; 
            
            if (os === 'ios') extraHeight += 190; // Safari UI bars
            if (os === 'android') extraHeight += 135; // Chrome UI bars
        } else if (type === 'desktop') {
            extraHeight += 146; 
            extraWidth += 32;
        } else if (type === 'tablet') {
            extraHeight += 170; // 110 UI + 60 Hardware
            extraWidth += 60;
        } else if (type === 'watch') {
            extraHeight += 104; 
            extraWidth += 24;
        }

        const frameHeight = height + extraHeight; 
        const frameWidth = width + extraWidth;

        const scaleH = availableHeight / frameHeight;
        const scaleW = availableWidth / frameWidth;
        let idealScale = Math.min(scaleH, scaleW, 1.2); 
        idealScale = Math.max(0.2, Math.floor(idealScale * 20) / 20);
        
        scaleSlider.value = idealScale;
        updateScale();
    }

    function updateScale() {
        const s = scaleSlider.value;
        scaleVal.innerText = Math.round(s * 100) + '%';
        scaleContainer.style.transform = `scale(${s})`;
    }

    // 6. Listeners
    goBtn.addEventListener('click', () => {
        let val = urlInput.value.trim();
        // Prevent auto-prepending https to chrome:// or edge://
        if (val && !val.startsWith('http') && !val.startsWith('chrome://') && !val.startsWith('edge://')) {
            val = 'https://' + val;
        }

        if (isRestrictedUrl(val)) {
            window.showGlobalAlert("Domain Secured", "I must decline. Chrome strictly forbids system pages and the Web Store from loading inside iframes.", "error");
            urlInput.value = targetUrl; // Revert input to last safe URL
            return;
        }

        targetUrl = val;
        applySettings();
    });

    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') goBtn.click();
    });

    rotateBtn.addEventListener('click', () => {
        const temp = width;
        width = height;
        height = temp;
        applySettings();
        setTimeout(autoFit, 350); 
    });

    deviceSelect.addEventListener('change', (e) => {
        const parts = e.target.value.split(',');
        width = parseInt(parts[0]);
        height = parseInt(parts[1]);
        type = parts[2];
        notch = parts[3] || 'notch-none';
        os = parts[4] || 'win';
        applySettings();
        setTimeout(autoFit, 350);
    });

    nativeBtn.addEventListener('click', () => {
        chrome.windows.create({ url: targetUrl, type: 'popup', width: width, height: height + 35 });
    });

    scaleSlider.addEventListener('input', updateScale);

	// 🟢 MULTI-PAGE QA ANNOTATION ENGINE & GALLERY
	let reportPages = []; 
	let canvasState = []; 
    let editingPageIndex = -1; // Tracks if we are editing an existing page
    
    const annoCanvas = document.getElementById('annotationCanvas');
    const ctx = annoCanvas.getContext('2d');
    
    let isDrawing = false;
    let startX, startY;
    let currentTool = 'brush';
    let currentColor = '#ef4444';
    let currentSize = 4;

    function saveCanvasState() {
        if (canvasState.length > 20) canvasState.shift(); 
        canvasState.push(annoCanvas.toDataURL());
    }

    function restoreCanvasState(index) {
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, annoCanvas.width, annoCanvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = canvasState[index];
    }

    function getMousePos(evt) {
        const rect = annoCanvas.getBoundingClientRect();
        const scaleX = annoCanvas.width / rect.width;
        const scaleY = annoCanvas.height / rect.height;
        return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
    }

    function drawArrow(context, fromx, fromy, tox, toy) {
        const headlen = currentSize * 4; 
        const dx = tox - fromx;
        const dy = toy - fromy;
        const angle = Math.atan2(dy, dx);
        context.beginPath();
        context.moveTo(fromx, fromy);
        context.lineTo(tox, toy);
        context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
        context.moveTo(tox, toy);
        context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
        context.stroke();
    }

    function captureDeviceFrame(onCapture, onError) {
        const header  = document.querySelector('.sim-header');
        const simBody = document.getElementById('simBody');
        const frameEl = document.getElementById('deviceFrame');
        const issuesPanel = document.getElementById('issuesPanel'); // 🟢 NEW: Grab the issues panel
        
        const oldScrollTop  = simBody.scrollTop;
        const oldScrollLeft = simBody.scrollLeft;

        header.style.opacity = '0';
        if (issuesPanel) issuesPanel.style.opacity = '0'; // 🟢 NEW: Turn panel invisible

        frameEl.scrollIntoView({ block: 'center', inline: 'center' });

        setTimeout(() => {
            const frameRect  = frameEl.getBoundingClientRect();
            const iframeEl   = document.getElementById('simFrame');
            const iframeRect = iframeEl.getBoundingClientRect();
            const dpr     = window.devicePixelRatio || 1;
            const padding = 50;

            const iframeOffset = {
                left: (iframeRect.left - frameRect.left + padding) * dpr,
                top:  (iframeRect.top  - frameRect.top  + padding) * dpr,
                dpr
            };

            chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                header.style.opacity = '1';
                if (issuesPanel) issuesPanel.style.opacity = '1';
                simBody.scrollTop  = oldScrollTop;
                simBody.scrollLeft = oldScrollLeft;

                // FIX 7b: guard against capture failure
                if (chrome.runtime.lastError || !dataUrl) {
                    const msg = chrome.runtime.lastError?.message || 'Screenshot unavailable.';
                    console.warn('[captureDeviceFrame] Failed:', msg);
                    if (onError) onError(msg); // ✅ FIX: Propagate failure to caller
                    return;
                }

                const base = new Image();
                base.onload = () => {
                    const isDesktop = frameEl.classList.contains('desktop');
                    const standH    = isDesktop ? (frameEl.querySelector('.hw-stand')?.getBoundingClientRect().height || 0) : 0;
                    
                    // 🟢 FIXED: Math.floor enforces rigid integer coordinates, eliminating sub-pixel antialiasing blur
                    const cropX = Math.floor(Math.max(0, (frameRect.left - padding) * dpr));
                    const cropY = Math.floor(Math.max(0, (frameRect.top  - padding) * dpr));
                    const cropW = Math.floor(Math.min(base.width  - cropX, (frameRect.width  + padding * 2) * dpr));
                    const cropH = Math.floor(Math.min(base.height - cropY, (frameRect.height + standH + padding * 2) * dpr));

                    const tmp = document.createElement('canvas');
                    tmp.width = cropW; tmp.height = cropH;
                    
                    const tmpCtx = tmp.getContext('2d');
                    tmpCtx.imageSmoothingEnabled = false; // 🟢 FIXED: Disables artificial smoothing for razor-sharp text
                    tmpCtx.drawImage(base, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                    
                    // 🟢 FIXED: Upgraded from compressed JPEG to lossless PNG
                    onCapture(tmp.toDataURL('image/png'), cropW, cropH, iframeOffset);
                };
                base.src = dataUrl;
            });
        }, 150);
    }

	// 1b. Open Annotation Studio — capture frame, load storage queue, open modal
    document.getElementById('simReportBtn')?.addEventListener('click', () => {
        const btn = document.getElementById('simReportBtn');
        const ORIGINAL_HTML = '<i class="bi bi-pencil-square me-1"></i> Annotate';
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        btn.disabled = true; // ✅ Prevent double-click during capture

        captureDeviceFrame(
            // ✅ SUCCESS path
            (croppedDataUrl, cropW, cropH, iframeOffset) => {
                // 🟢 FIXED: Removed the undeclared 'annoState' variable that was crashing the script!

                const baseImage = new Image();
                baseImage.onload = () => {
                    annoCanvas.width  = cropW;
                    annoCanvas.height = cropH;
                    ctx.drawImage(baseImage, 0, 0);

                    canvasState = [];
                    saveCanvasState();
                    editingPageIndex = -1;
                    document.getElementById('repoBugTitle').value = '';
                    document.getElementById('repoBugDesc').value  = '';
                    document.getElementById('btnAddPageToReport').innerHTML = '<i class="bi bi-file-earmark-plus fs-5"></i> Save & Add to PDF';

                    btn.innerHTML = ORIGINAL_HTML;
                    btn.disabled = false;
                    new bootstrap.Modal(document.getElementById('annotationModal')).show();
                };
                baseImage.onerror = () => { // ✅ Guard: if the dataUrl itself is corrupt
                    btn.innerHTML = ORIGINAL_HTML;
                    btn.disabled = false;
                    window.showGlobalAlert("Capture Error", "The screenshot data was unreadable. Please try again.", "error");
                };
                baseImage.src = croppedDataUrl;
            },
            // ✅ ERROR path — spinner now always restores
            (errMsg) => {
                btn.innerHTML = ORIGINAL_HTML;
                btn.disabled = false;
                window.showGlobalAlert("Capture Failed", errMsg || "Could not take a screenshot. Ensure the tab is focused and try again.", "error");
            }
        );
    });

    // 2. Canvas Event Listeners
    annoCanvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        const pos = getMousePos(e);
        startX = pos.x;
        startY = pos.y;
        
        currentTool = document.querySelector('input[name="drawTool"]:checked').value;
        currentColor = document.getElementById('drawColor').value;
        currentSize = parseInt(document.getElementById('drawSize').value);

        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (currentTool === 'brush') {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
        }
    });

    annoCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const pos = getMousePos(e);

        if (currentTool === 'brush') {
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        } else {
            // FIX 6: Use onload callback instead of setTimeout race
            const snapIdx = canvasState.length - 1;
            const snapImg = new Image();
            snapImg.onload = () => {
                ctx.clearRect(0, 0, annoCanvas.width, annoCanvas.height);
                ctx.drawImage(snapImg, 0, 0);
                ctx.strokeStyle = currentColor;
                ctx.lineWidth = currentSize;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (currentTool === 'rect') ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
                else if (currentTool === 'arrow') drawArrow(ctx, startX, startY, pos.x, pos.y);
            };
            snapImg.src = canvasState[snapIdx];
        }
    });

    annoCanvas.addEventListener('mouseup', () => {
        if (!isDrawing) return;
        isDrawing = false;
        setTimeout(saveCanvasState, 10);
    });

    // FIX 5: Treat leaving the canvas exactly like releasing the mouse button
    annoCanvas.addEventListener('mouseleave', () => {
        if (!isDrawing) return;
        isDrawing = false;
        setTimeout(saveCanvasState, 10);
    });

    // FIX 4: Reset drawing state when the modal is closed any way (ESC, ×, backdrop)
    document.getElementById('annotationModal')?.addEventListener('hidden.bs.modal', () => {
        isDrawing = false;
    });

    document.getElementById('btnUndo').addEventListener('click', () => {
        if (canvasState.length > 1) {
            canvasState.pop(); 
            restoreCanvasState(canvasState.length - 1); 
        }
    });

    document.getElementById('btnResetCanvas').addEventListener('click', () => {
        if (canvasState.length > 0) {
            restoreCanvasState(0); 
            canvasState = [canvasState[0]]; 
        }
    });

    // 3. Save / Update Page in Array
    document.getElementById('btnAddPageToReport')?.addEventListener('click', () => {
        const title = document.getElementById('repoBugTitle').value || `QA Observation`;
        const desc = document.getElementById('repoBugDesc').value || "No additional notes provided.";
        const resolution = document.getElementById('simDeviceSelect').options[document.getElementById('simDeviceSelect').selectedIndex].text;
        
        const pageData = {
            finalImg: annoCanvas.toDataURL('image/png'),
            canvasState: [...canvasState], // Save drawing history so it can be edited later
            width: annoCanvas.width,
            height: annoCanvas.height,
            title: title,
            desc: desc,
            res: resolution,
            time: new Date().toLocaleString()
        };

        if (editingPageIndex > -1) {
            reportPages[editingPageIndex] = pageData;
            window.showGlobalAlert("Page Updated", `Page ${editingPageIndex + 1} has been updated.`, "success");
        } else {
            reportPages.push(pageData);
            window.showGlobalAlert("Page Added", `Report currently has ${reportPages.length} page(s).`, "success");
        }
        
        updatePdfButton();
        bootstrap.Modal.getInstance(document.getElementById('annotationModal'))?.hide();
    });

    function updatePdfButton() {
        const pdfBtn = document.getElementById('simDownloadPdfBtn');
        document.getElementById('pdfPageCount').innerText = reportPages.length;
        if (reportPages.length > 0) {
            pdfBtn.classList.remove('d-none');
            pdfBtn.classList.add('d-flex');
        } else {
            pdfBtn.classList.add('d-none');
            pdfBtn.classList.remove('d-flex');
        }
    }

    // 4. Open Review Gallery
    document.getElementById('simDownloadPdfBtn')?.addEventListener('click', () => {
        renderReviewGallery();
        new bootstrap.Modal(document.getElementById('reportReviewModal')).show();
    });

    // FIX 9: Safe HTML escape helper used throughout renderReviewGallery (shared: scripts/safe_html.js)
    function escHtml(str) {
        return MarquisHtml.esc(str);
    }

    function renderReviewGallery() {
        const list = document.getElementById('reviewPagesList');
        list.innerHTML = '';

        if (reportPages.length === 0) {
            list.innerHTML = `<div class="text-center text-muted fst-italic py-5 w-100">No pages added yet.</div>`;
            return;
        }

        reportPages.forEach((page, index) => {
            const col = document.createElement('div');
            col.className = 'col-md-6 col-lg-4';
            col.innerHTML = `
                <div class="card bg-dark border-secondary-subtle shadow-sm h-100">
                    <div class="card-img-top bg-black d-flex align-items-center justify-content-center p-2" style="height: 180px; overflow: hidden;">
                        <img src="${escHtml(page.finalImg)}" style="max-height: 100%; max-width: 100%; object-fit: contain;">
                    </div>
                    <div class="card-body p-3 d-flex flex-column">
                        <h6 class="fw-bold text-white text-truncate mb-1">Page ${index + 1}: ${escHtml(page.title)}</h6>
                        <p class="small text-muted text-truncate mb-3">${escHtml(page.desc)}</p>
                        
                        <div class="mt-auto d-flex gap-2">
                            <button class="btn btn-sm btn-primary flex-fill fw-bold edit-page-btn" data-index="${index}">
                                <i class="bi bi-pencil me-1"></i> Edit
                            </button>
                            <button class="btn btn-sm btn-outline-danger px-3 delete-page-btn" data-index="${index}" title="Delete Page">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            list.appendChild(col);
        });

        // Attach Gallery Listeners
        document.querySelectorAll('.delete-page-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10); // FIX 10
                reportPages.splice(idx, 1);
                renderReviewGallery();
                updatePdfButton();
                if (reportPages.length === 0) bootstrap.Modal.getInstance(document.getElementById('reportReviewModal'))?.hide();
            });
        });

        document.querySelectorAll('.edit-page-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const page = reportPages[idx];
                
                // Load saved data back into Studio
                editingPageIndex = idx;
                canvasState = [...page.canvasState];
                annoCanvas.width = page.width;
                annoCanvas.height = page.height;
                restoreCanvasState(canvasState.length - 1);
                
                document.getElementById('repoBugTitle').value = page.title;
                document.getElementById('repoBugDesc').value = page.desc;
                document.getElementById('btnAddPageToReport').innerHTML = '<i class="bi bi-save fs-5"></i> Update Page';

                bootstrap.Modal.getInstance(document.getElementById('reportReviewModal'))?.hide();
                new bootstrap.Modal(document.getElementById('annotationModal')).show();
            });
        });
    }

    // 5. Finally Download the PDF
    document.getElementById('btnGenerateFinalPdf')?.addEventListener('click', async () => {
        if (reportPages.length === 0) return;

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const projectUrl = new URLSearchParams(window.location.search).get('url') || 'Unknown';

        // 🟢 0.5" Narrow Margin (approx 12.7mm)
        const margin = 12.7;

        reportPages.forEach((page, index) => {
            if (index > 0) pdf.addPage(); 

            // Header Background
            pdf.setFillColor(30, 41, 59); 
            pdf.rect(0, 0, pageWidth, 40, 'F');
            
            // Header Text
            pdf.setTextColor(255, 255, 255);
            pdf.setFontSize(22);
            pdf.text("QA BUG REPORT", margin, 25);
            pdf.setFontSize(10);
            pdf.text(`Project: ${projectUrl}`, margin, 33);

            // Specifications Section
            pdf.setTextColor(40, 40, 40);
            pdf.setFont(undefined, 'bold');
            pdf.text("SPECIFICATIONS", margin, 55);
            pdf.setFont(undefined, 'normal');
            pdf.text([ `Issue: ${page.title}`, `Resolution: ${page.res}`, `Timestamp: ${page.time}` ], margin, 62);

            // Observation Section
            pdf.setFont(undefined, 'bold');
            pdf.text("OBSERVATION", margin, 90);
            pdf.setFont(undefined, 'normal');
            
            // 🟢 DYNAMIC TEXT WRAPPING
            // Wrap text based on page width minus left & right margins
            const splitDesc = pdf.splitTextToSize(page.desc, pageWidth - (margin * 2));
            pdf.text(splitDesc, margin, 97);

            // 🟢 DYNAMIC Y-POSITIONING
            // Each line of text at size 10 takes up roughly 5mm of vertical space.
            const textHeight = splitDesc.length * 5; 
            const imageStartY = 97 + textHeight + 10; // Start image 10mm below the text

            // 🟢 ADAPTIVE IMAGE RESIZING
            // Calculate how much room is left on the page (leaving 20mm for the footer)
            const availableHeight = pageHeight - imageStartY - 20;
            const maxW = pageWidth - (margin * 2);
            
            const imgProps = pdf.getImageProperties(page.finalImg);
            let pdfImgW = maxW;
            let pdfImgH = (imgProps.height * maxW) / imgProps.width;

            // If the image is taller than the available space, shrink it to fit
            if (pdfImgH > availableHeight) {
                pdfImgH = availableHeight;
                pdfImgW = (imgProps.width * availableHeight) / imgProps.height;
            }

            // Center the image horizontally
            const xPos = (pageWidth - pdfImgW) / 2;
            pdf.addImage(page.finalImg, 'PNG', xPos, imageStartY, pdfImgW, pdfImgH);

            // Footer
            pdf.setDrawColor(200, 200, 200);
            pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15); 
            pdf.setTextColor(150, 150, 150);
            pdf.setFontSize(8);
            pdf.text("Generated via Marquis QA Simulator", margin, pageHeight - 10);
            pdf.text(`Page ${index + 1} of ${reportPages.length}`, pageWidth - margin - 20, pageHeight - 10);
        });

        pdf.save(`QA_Report_${Date.now()}.pdf`);
        
        // Clean up and reset
        reportPages = [];
        updatePdfButton();
        bootstrap.Modal.getInstance(document.getElementById('reportReviewModal'))?.hide();
        window.showGlobalAlert("Report Exported", "Multi-page PDF has been downloaded successfully.", "success");
    });

    // ── LAYOUT DETECTION ────────────────────────────────────────────────────
    LayoutDetector.init();

    // Keep frameId in sync whenever the iframe navigates
    frame.addEventListener('load', () => {
        setTimeout(() => {
            LayoutDetector.resolveFrameId(frame.src).then(id => { LayoutDetector.frameId = id; });
        }, 600);
    });

    const detectBtn   = document.getElementById('simDetectBtn');
    const issuesPanel = document.getElementById('issuesPanel');
    const closePanelBtn = document.getElementById('closePanelBtn');

    detectBtn?.addEventListener('click', async () => {
        // Open panel
        issuesPanel.style.right = '0';

        // Loading state
        detectBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" style="width:12px;height:12px;border-width:2px;"></span> Scanning...';
        detectBtn.disabled = true;
        document.getElementById('issueSummary').textContent = `Analyzing ${width}×${height} layout…`;
        document.getElementById('issueCount').textContent = '…';
        document.getElementById('issuesList').innerHTML = `
            <div style="text-align:center; padding: 50px 20px;">
                <div class="spinner-border" style="color:var(--mq-warning); width:2rem; height:2rem; border-width:3px; margin-bottom:14px;"></div>
                <div style="font-size:13px; color:var(--mq-text-muted);">Scanning ${width}×${height} on ${os.toUpperCase()}…</div>
            </div>`;

        const { safeTop, safeBottom } = LayoutDetector.getSafeArea(notch, os, type);
        const deviceCtx = { width, height, type, notch, os, url: targetUrl, safeTop, safeBottom };

        const issues = await LayoutDetector.detect(deviceCtx);
        if (issues === null) {
            document.getElementById('issuesList').innerHTML = `
                <div style="background:var(--mq-surface); border:1px solid #f59e0b; border-radius:10px; padding:18px 16px; color:#fbbf24; font-size:13px; line-height:1.6;">
                    <div style="font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                        <i class="bi bi-shield-lock-fill"></i> Cross-origin restriction
                    </div>
                    <div style="color:var(--mq-text-2);">The browser blocks DOM inspection of cross-origin pages. Load a page from the same origin or disable cross-origin isolation to use this feature.</div>
                </div>`;
            document.getElementById('issueCount').textContent = '?';
            document.getElementById('issueSummary').textContent = 'Cross-origin page — cannot inspect';
            detectBtn.innerHTML = '<i class="bi bi-bug me-1"></i> Detect';
            detectBtn.disabled = false;
            return;
        }
        LayoutDetector.issues = mergeIssuesBySelector(issues);

        detectBtn.innerHTML = '<i class="bi bi-bug me-1"></i> Detect';
        detectBtn.disabled = false;



        // Reset filter to "All"
        document.querySelectorAll('.iq-tab').forEach(t => {
            t.style.borderBottomColor = 'transparent';
            t.style.color = 'var(--mq-text-muted)';
        });
        const allTab = document.querySelector('.iq-tab[data-filter="all"]');
        if (allTab) { allTab.style.borderBottomColor = '#f59e0b'; allTab.style.color = 'var(--mq-warning)'; }

        renderIssues(LayoutDetector.issues, 'all');
    });

    closePanelBtn?.addEventListener('click', () => {
        issuesPanel.style.right = '-440px';
        LayoutDetector.clearHighlights();
    });

    // Filter tab clicks
    document.querySelectorAll('.iq-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            document.querySelectorAll('.iq-tab').forEach(t => {
                t.style.borderBottomColor = 'transparent'; t.style.color = 'var(--mq-text-muted)';
            });
            e.currentTarget.style.borderBottomColor = '#f59e0b';
            e.currentTarget.style.color = 'var(--mq-warning)';
            renderIssues(LayoutDetector.issues, e.currentTarget.getAttribute('data-filter'));
        });
    });

    // ── TYPE_META shared by mergeIssuesBySelector and renderIssues ─────────────
    const TYPE_META = {
        overflow:          { icon: 'bi-arrows-expand',      label: 'Overflow'     },
        outOfBounds:       { icon: 'bi-box-arrow-right',    label: 'Out of Bounds'},
        textClipping:      { icon: 'bi-type',               label: 'Text Clip'    },
        fixedSticky:       { icon: 'bi-pin-angle-fill',     label: 'Fixed/Sticky' },
        notchOcclusion:    { icon: 'bi-phone',              label: 'Safe Area'    },
        tapTarget:         { icon: 'bi-hand-index-thumb',   label: 'Tap Target'   },
        overlap:           { icon: 'bi-layers-fill',        label: 'Overlap'      },
        tinyText:          { icon: 'bi-search',             label: 'Legibility'   },
        iosZoom:           { icon: 'bi-zoom-in',            label: 'iOS Zoom'     },
        emptyInteractive:  { icon: 'bi-cursor',             label: 'Ghost Target' },
        unconstrainedMedia:{ icon: 'bi-image',              label: 'Large Media'  },
        distortedImage:    { icon: 'bi-aspect-ratio',       label: 'Distortion'   },
        fatFinger:         { icon: 'bi-exclude',            label: 'Proximity'    },
        zIndexAbuse:       { icon: 'bi-sort-up',            label: 'Z-Index'      },
        mediaAutoplay:     { icon: 'bi-play-btn',           label: 'Autoplay'     },
        recklessLink:      { icon: 'bi-shield-exclamation', label: 'Security'     },
        orphanedInput:     { icon: 'bi-ui-radios',          label: 'A11y'         },
        archaicHtml:       { icon: 'bi-hourglass-bottom',   label: 'Deprecated'   },
        semanticAnarchy:   { icon: 'bi-list-ol',            label: 'Structure'    }
    };

    // ── mergeIssuesBySelector — collapses multiple issues on the same element ──
    function mergeIssuesBySelector(rawIssues) {
        const SEV_RANK = { error: 3, warning: 2, info: 1 };
        const groups   = new Map();
        const order    = [];

        for (const issue of rawIssues) {
            const key = issue.selector || '__global__';
            if (!groups.has(key)) { groups.set(key, []); order.push(key); }
            groups.get(key).push(issue);
        }

        const merged = [];
        for (const key of order) {
            const group = groups.get(key);
            if (group.length === 1) { merged.push(group[0]); continue; }

            const worstSev = group.reduce((best, i) =>
                (SEV_RANK[i.severity] || 0) > (SEV_RANK[best] || 0) ? i.severity : best,
                'info');

            const labels = [...new Set(group.map(i =>
                (TYPE_META[i.type] || { label: i.type }).label))];
            const labelStr = labels.length === 1 ? labels[0]
                : labels.length === 2 ? labels.join(' & ')
                : labels.slice(0, -1).join(', ') + ' & ' + labels.at(-1);

            const fixes = [...new Set(group.map(i => i.fix).filter(Boolean))];
            const primary = group.find(i => i.severity === worstSev) || group[0];

            merged.push({
                ...primary,
                severity:    worstSev,
                title:       `${key} — ${labelStr} ${labels.length > 1 ? 'issues' : 'issue'}`,
                description: group.map((i, n) => `[${n + 1}] ${i.description}`).join('\n\n'),
                fix:         fixes.join('\n\n'),
                rect:        group.find(i => i.rect)?.rect ?? null,
                _merged:     group
            });
        }
        return merged;
    }

    function renderIssues(issues, filter) {
        const errors   = issues.filter(i => i.severity === 'error').length;
        const warnings = issues.filter(i => i.severity === 'warning').length;
        const infos    = issues.filter(i => i.severity === 'info').length;

        document.getElementById('issueCount').textContent = issues.length;
        if (issues.length === 0) {
            document.getElementById('issueSummary').textContent = '✅ No issues found on this layout';
        } else {
            const parts = [];
            if (errors)   parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
            if (warnings) parts.push(`${warnings} warning${warnings > 1 ? 's' : ''}`);
            if (infos)    parts.push(`${infos} info`);
            document.getElementById('issueSummary').textContent = parts.join(' · ');
        }

        const filtered = filter === 'all' ? issues : issues.filter(i => i.severity === filter);
        const list = document.getElementById('issuesList');

        if (filtered.length === 0) {
            list.innerHTML = `
                <div style="text-align:center; color:var(--mq-text-2); padding:50px 20px; font-size:13px;">
                    <i class="bi bi-check-circle-fill" style="font-size:32px; display:block; margin-bottom:12px; color:var(--mq-success); opacity:0.7;"></i>
                    No ${filter === 'all' ? '' : filter + ' '}issues detected on this device!
                </div>`;
            return;
        }

        const SEV_COLOR = { error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };

        list.innerHTML = '';

        filtered.forEach(issue => {
            const realIdx = issues.indexOf(issue);
            const c = SEV_COLOR[issue.severity] || '#3b82f6';
            const meta = TYPE_META[issue.type] || { icon: 'bi-exclamation-circle', label: issue.type };

            const card = document.createElement('div');
            card.className = 'iq-card';
            card.setAttribute('data-index', realIdx);
            card.style.cssText = `
                background: #1e293b; border: 1px solid #2d3f55;
                border-left: 3px solid ${c}; border-radius: 8px;
                padding: 12px 13px; cursor: pointer;
                transition: background 0.15s, border-color 0.15s;
            `;

            card.innerHTML = `
                <div style="display:flex; align-items:flex-start; gap:10px;">
                    <div style="
                        background:${c}1a; color:${c}; border-radius:7px;
                        padding:8px; font-size:15px; flex-shrink:0; line-height:1;
                    "><i class="bi ${meta.icon}"></i></div>
                    <div style="min-width:0; flex:1;">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
                            <span style="font-size:12px; font-weight:700; color:var(--mq-text); line-height:1.3;">${MarquisHtml.esc(issue.title)}</span>
                            <span style="font-size:12px; font-weight:700; background:${c}22; color:${c}; padding:1px 6px; border-radius:10px; text-transform:uppercase; letter-spacing:0.5px; white-space:nowrap;">${meta.label}</span>
                        </div>
                        <div style="font-size:12px; color:var(--mq-text-muted); line-height:1.5; margin-bottom:7px;">${MarquisHtml.esc(issue.description)}</div>
                        <div style="font-family:monospace; font-size:12px; color:var(--mq-text-2); background:var(--mq-sunken); padding:2px 7px; border-radius:4px; display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-bottom:${issue.fix ? '7px' : '0'};">${MarquisHtml.esc(issue.selector)}</div>
                        ${issue.fix ? `
                        <div style="font-size:12px; color:var(--mq-success); display:flex; align-items:flex-start; gap:5px; line-height:1.4;">
                            <i class="bi bi-lightbulb-fill" style="flex-shrink:0; margin-top:1px;"></i>
                            <span>${MarquisHtml.esc(issue.fix)}</span>
                        </div>` : ''}
                    </div>
                </div>`;

            card.addEventListener('click', () => {
                document.querySelectorAll('.iq-card').forEach(c2 => c2.style.background = 'var(--mq-surface)');
                card.style.background = '#1a3050';
                LayoutDetector.highlightIssue(issues[realIdx]);
            });
            card.addEventListener('mouseenter', () => { if (card.style.background !== 'rgb(26, 48, 80)') card.style.background = 'color-mix(in srgb, var(--mq-surface) 85%, var(--mq-text))'; });
            card.addEventListener('mouseleave', () => { if (card.style.background !== 'rgb(26, 48, 80)') card.style.background = 'var(--mq-surface)'; });

            // "Add to PDF" — captures snapshot + pushes directly to the report deck
            const stampQuick = document.createElement('button');
            stampQuick.innerHTML = '<i class="bi bi-file-earmark-plus-fill"></i> Add to PDF';
            stampQuick.style.cssText = `
                margin-top:7px; background:#1a2840; border:1px solid #334155; color:#64748b;
                border-radius:5px; padding:3px 9px; font-size:12px; font-weight:700;
                cursor:pointer; transition:all 0.12s; display:inline-flex; align-items:center; gap:4px;
            `;
            stampQuick.title = 'Capture current view and add directly to the PDF report';

            stampQuick.addEventListener('mouseenter', () => {
                if (!stampQuick.dataset.saved) { stampQuick.style.color = 'var(--mq-text)'; stampQuick.style.borderColor = 'var(--mq-border)'; }
            });
            stampQuick.addEventListener('mouseleave', () => {
                if (!stampQuick.dataset.saved) { stampQuick.style.color = 'var(--mq-text-muted)'; stampQuick.style.borderColor = 'var(--mq-border-subtle)'; }
            });

            stampQuick.addEventListener('click', e => {
                e.stopPropagation();
                if (stampQuick.dataset.saved) return;
                const issue = issues[realIdx];

                stampQuick.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:9px;height:9px;border-width:2px;"></span> Capturing…';
                stampQuick.style.pointerEvents = 'none';

                captureDeviceFrame((croppedDataUrl, cropW, cropH) => {
                    const isDupe = reportPages.some(p => p.title === issue.title);
                    if (isDupe) {
                        window.showGlobalAlert('Redundant Request', `"${issue.title.slice(0, 40)}" already graces your report.`, 'warning');
                        stampQuick.innerHTML = '<i class="bi bi-file-earmark-plus-fill"></i> Add to PDF';
                        stampQuick.style.pointerEvents = '';
                        return;
                    }

                    const resolution = document.getElementById('simDeviceSelect').options[document.getElementById('simDeviceSelect').selectedIndex].text;
                    const fullDesc = (issue.description || '') + (issue.fix ? `\n\nSuggested Fix: ${issue.fix}` : '');

                    const pageData = {
                        finalImg: croppedDataUrl,
                        canvasState: [croppedDataUrl], // Baseline state so it can be edited later via the Gallery!
                        width: cropW,
                        height: cropH,
                        title: issue.title,
                        desc: fullDesc,
                        res: resolution,
                        time: new Date().toLocaleString()
                    };

                    reportPages.push(pageData);
                    updatePdfButton(); // Updates the PDF counter in the main UI

                    stampQuick.dataset.saved = '1';
                    stampQuick.innerHTML = '<i class="bi bi-check-lg"></i> Added to Report';
                    stampQuick.style.color = 'var(--mq-success)';
                    stampQuick.style.borderColor = '#10b981';
                    stampQuick.style.background = '#10b98118';
                    window.showGlobalAlert('Report Updated', `"${issue.title.slice(0, 40)}" has been added directly to the PDF report.`, 'success');
                });
            });
            card.querySelector('div > div').appendChild(stampQuick);

            list.appendChild(card);
        });
    }

    // 7. Initialize
    applySettings();
    setTimeout(autoFit, 100);
    window.addEventListener('resize', () => setTimeout(autoFit, 200));

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🎛️  PANEL TAB SYSTEM — mutually exclusive slide-in panels
    // ═══════════════════════════════════════════════════════════════════════════════
    const ALL_SIM_PANELS = ['ghostPanel','gridPanel','diffPanel','visionPanel','enterprisePanel','issuesPanel', 'psiPanel'];

    function closeAllSimPanels() {
        ALL_SIM_PANELS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.right = '-440px';
        });
        // 🟢 FIXED: Remove the 'active' state from dropdown items
        document.querySelectorAll('.sim-tab-btn').forEach(b => {
            b.classList.remove('active');
        });
    }

    function openSimPanel(panelId, tabBtn) {
        closeAllSimPanels();
        const panel = document.getElementById(panelId);
        if (panel) panel.style.right = '0';
        if (tabBtn) {
            // 🟢 FIXED: Apply Bootstrap's native active class to the dropdown item
            tabBtn.classList.add('active');
        }
    }

    // Tab button click — toggle on/off
    document.querySelectorAll('.sim-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); // 🟢 FIXED: Stop the <a> tag from jumping the page to top
            const panelId = btn.getAttribute('data-tab') + 'Panel';
            const panel = document.getElementById(panelId);
            if (panel && panel.style.right === '0px') { closeAllSimPanels(); return; }
            openSimPanel(panelId, btn);
        });
    });

    // Close buttons
    document.getElementById('closeGhostPanelBtn')?.addEventListener('click', closeAllSimPanels);
    document.getElementById('closeGridPanelBtn')?.addEventListener('click', closeAllSimPanels);
    document.getElementById('closeDiffPanelBtn')?.addEventListener('click', closeAllSimPanels);
    document.getElementById('closeVisionPanelBtn')?.addEventListener('click', closeAllSimPanels);
    document.getElementById('closeEnterprisePanelBtn')?.addEventListener('click', closeAllSimPanels);
    document.getElementById('closePsiPanelBtn')?.addEventListener('click', closeAllSimPanels);

    // ═══════════════════════════════════════════════════════════════════════════════
    // 👻  GHOST OVERLAY
    // ═══════════════════════════════════════════════════════════════════════════════
    let ghostDataUrl = null;
    let ghostVisible = true;

    const ghostUploadZone  = document.getElementById('ghostUploadZone');
    const ghostFileInput   = document.getElementById('ghostFileInput');
    const ghostControls    = document.getElementById('ghostControls');
    const ghostPreviewImg  = document.getElementById('ghostPreviewImg');
    const ghostOpacitySlider = document.getElementById('ghostOpacity');
    const ghostOpacityVal  = document.getElementById('ghostOpacityVal');
    const ghostOffsetX     = document.getElementById('ghostOffsetX');
    const ghostOffsetXVal  = document.getElementById('ghostOffsetXVal');
    const ghostOffsetY     = document.getElementById('ghostOffsetY');
    const ghostOffsetYVal  = document.getElementById('ghostOffsetYVal');
    const ghostScaleSlider = document.getElementById('ghostScale');
    const ghostScaleVal    = document.getElementById('ghostScaleVal');
    const ghostToggleBtn   = document.getElementById('ghostToggleBtn');
    const ghostClearBtn    = document.getElementById('ghostClearBtn');

    ghostUploadZone?.addEventListener('click', () => ghostFileInput?.click());
    ghostUploadZone?.addEventListener('dragover', e => { e.preventDefault(); ghostUploadZone.style.borderColor = '#a855f7'; });
    ghostUploadZone?.addEventListener('dragleave', () => { ghostUploadZone.style.borderColor = 'var(--mq-border-subtle)'; });
    ghostUploadZone?.addEventListener('drop', e => {
        e.preventDefault(); ghostUploadZone.style.borderColor = 'var(--mq-border-subtle)';
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) _loadGhostFile(f);
    });
    ghostFileInput?.addEventListener('change', e => { if (e.target.files[0]) _loadGhostFile(e.target.files[0]); });

    function _loadGhostFile(file) {
        const reader = new FileReader();
        reader.onload = ev => {
            ghostDataUrl = ev.target.result;
            if (ghostPreviewImg) ghostPreviewImg.src = ghostDataUrl;
            if (ghostControls) ghostControls.style.display = 'flex';
            if (ghostUploadZone) ghostUploadZone.style.display = 'none';
            ghostVisible = true;
            _updateGhostOverlay();
        };
        reader.readAsDataURL(file);
    }

    function _updateGhostOverlay() {
        if (!ghostDataUrl || LayoutDetector.frameId === null) return;
        const opacity  = ghostVisible ? (parseInt(ghostOpacitySlider?.value ?? 50) / 100) : 0;
        const ox       = parseInt(ghostOffsetX?.value ?? 0);
        const oy       = parseInt(ghostOffsetY?.value ?? 0);
        const sc       = parseInt(ghostScaleSlider?.value ?? 100) / 100;
        chrome.scripting.executeScript({
            target: { tabId: LayoutDetector.tabId, frameIds: [LayoutDetector.frameId] },
            func: (src, op, ox, oy, sc) => {
                let el = document.getElementById('_mqGhost');
                if (!el) { el = document.createElement('img'); el.id = '_mqGhost'; el.style.cssText = 'position:fixed;top:0;left:0;width:100%;pointer-events:none;z-index:2147483640;transform-origin:top left;'; document.body.appendChild(el); }
                el.src = src; el.style.opacity = op; el.style.transform = `translate(${ox}px,${oy}px) scale(${sc})`;
            }, args: [ghostDataUrl, opacity, ox, oy, sc]
        }).catch(() => {});
    }

    [ghostOpacitySlider, ghostOffsetX, ghostOffsetY, ghostScaleSlider].forEach(el => {
        el?.addEventListener('input', () => {
            if (ghostOpacityVal)  ghostOpacityVal.textContent  = (ghostOpacitySlider?.value ?? 50)  + '%';
            if (ghostOffsetXVal)  ghostOffsetXVal.textContent  = (ghostOffsetX?.value ?? 0)  + 'px';
            if (ghostOffsetYVal)  ghostOffsetYVal.textContent  = (ghostOffsetY?.value ?? 0)  + 'px';
            if (ghostScaleVal)    ghostScaleVal.textContent    = (ghostScaleSlider?.value ?? 100) + '%';
            _updateGhostOverlay();
        });
    });

    ghostToggleBtn?.addEventListener('click', () => {
        ghostVisible = !ghostVisible;
        ghostToggleBtn.innerHTML       = ghostVisible ? '<i class="bi bi-eye me-1"></i>Visible' : '<i class="bi bi-eye-slash me-1"></i>Hidden';
        ghostToggleBtn.style.background = ghostVisible ? '#a855f7' : 'var(--mq-surface)';
        ghostToggleBtn.style.color      = ghostVisible ? '#fff' : '#a855f7';
        ghostToggleBtn.style.border     = ghostVisible ? 'none' : '1px solid #a855f7';
        _updateGhostOverlay();
    });

    ghostClearBtn?.addEventListener('click', () => {
        ghostDataUrl = null;
        if (ghostControls) ghostControls.style.display = 'none';
        if (ghostUploadZone) ghostUploadZone.style.display = 'block';
        if (ghostFileInput) ghostFileInput.value = '';
        if (LayoutDetector.frameId !== null) {
            chrome.scripting.executeScript({ target: { tabId: LayoutDetector.tabId, frameIds: [LayoutDetector.frameId] }, func: () => document.getElementById('_mqGhost')?.remove() }).catch(() => {});
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // 📐  LAYOUT GRID
    // ═══════════════════════════════════════════════════════════════════════════════
    let _colGridOn = false;
    let _baseGridOn = false;

    function _execInFrame(fn, args = []) {
        if (LayoutDetector.frameId === null) return Promise.reject('no frame');
        return chrome.scripting.executeScript({ target: { tabId: LayoutDetector.tabId, frameIds: [LayoutDetector.frameId] }, func: fn, args });
    }

    document.getElementById('gridOpacity')?.addEventListener('input', e => {
        if (document.getElementById('gridOpacityVal')) document.getElementById('gridOpacityVal').textContent = e.target.value + '%';
        if (_colGridOn) _injectColumnGrid();
    });

    function _injectColumnGrid() {
        const cols     = parseInt(document.getElementById('gridCols')?.value)     || 12;
        const gutter   = parseInt(document.getElementById('gridGutter')?.value)   || 24;
        const maxW     = parseInt(document.getElementById('gridMaxWidth')?.value)  || 1140;
        const color    = document.getElementById('gridColor')?.value               || '#3b82f6';
        const opacity  = (parseInt(document.getElementById('gridOpacity')?.value)  || 20) / 100;
        const hex = color.replace('#','');
        const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
        const rgba = `rgba(${r},${g},${b},${opacity})`;
        _execInFrame((cols,gutter,maxW,rgba) => {
            let el = document.getElementById('_mqColGrid');
            if (!el) { el = document.createElement('div'); el.id = '_mqColGrid'; el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483638;pointer-events:none;display:flex;justify-content:center;'; document.body.appendChild(el); }
            let h = `<div style="display:flex;width:100%;max-width:${maxW}px;height:100%;gap:${gutter}px;padding:0 ${gutter/2}px;">`;
            for (let i=0;i<cols;i++) h += `<div style="flex:1;height:100%;background:${rgba};"></div>`;
            el.innerHTML = h + '</div>';
        }, [cols,gutter,maxW,rgba]).catch(() => {});
        _colGridOn = true;
        const btn = document.getElementById('gridToggleBtn');
        if (btn) { btn.style.background='#0e7490'; btn.innerHTML='<i class="bi bi-grid-3x3-gap me-1"></i>Remove Column Grid'; }
    }

    function _removeColumnGrid() {
        _execInFrame(() => document.getElementById('_mqColGrid')?.remove()).catch(() => {});
        _colGridOn = false;
        const btn = document.getElementById('gridToggleBtn');
        if (btn) { btn.style.background='#06b6d4'; btn.style.color='#0f172a'; btn.innerHTML='<i class="bi bi-grid-3x3-gap me-1"></i>Inject Column Grid'; }
    }

    document.getElementById('gridToggleBtn')?.addEventListener('click', () => { _colGridOn ? _removeColumnGrid() : _injectColumnGrid(); });

    function _injectBaselineGrid() {
        const size  = parseInt(document.getElementById('baselineSize')?.value) || 8;
        const color = document.getElementById('baselineColor')?.value || '#f59e0b';
        const hex = color.replace('#','');
        const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
        const rgba = `rgba(${r},${g},${b},0.25)`;
        _execInFrame((size,rgba) => {
            let el = document.getElementById('_mqBaseGrid');
            if (!el) { el = document.createElement('div'); el.id = '_mqBaseGrid'; document.body.appendChild(el); }
            el.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483637;pointer-events:none;background-image:repeating-linear-gradient(to bottom,${rgba} 0px,${rgba} 1px,transparent 1px,transparent ${size}px);background-size:100% ${size}px;`;
        }, [size,rgba]).catch(() => {});
        _baseGridOn = true;
        const btn = document.getElementById('baselineToggleBtn');
        if (btn) { btn.style.background='#78350f'; btn.style.color='#f59e0b'; btn.style.border='none'; btn.innerHTML='<i class="bi bi-list-columns me-1"></i>Remove Baseline Grid'; }
    }

    function _removeBaselineGrid() {
        _execInFrame(() => document.getElementById('_mqBaseGrid')?.remove()).catch(() => {});
        _baseGridOn = false;
        const btn = document.getElementById('baselineToggleBtn');
        if (btn) { btn.style.background='var(--mq-surface)'; btn.style.color='var(--mq-warning)'; btn.style.border='1px solid #f59e0b'; btn.innerHTML='<i class="bi bi-list-columns me-1"></i>Inject Baseline Grid'; }
    }

    document.getElementById('baselineToggleBtn')?.addEventListener('click', () => { _baseGridOn ? _removeBaselineGrid() : _injectBaselineGrid(); });
    document.getElementById('gridClearAllBtn')?.addEventListener('click', () => { _removeColumnGrid(); _removeBaselineGrid(); });

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔬  VISUAL DIFF
    // ═══════════════════════════════════════════════════════════════════════════════
    let _diffBaseline = null;
    let _diffCurrent  = null;

    document.getElementById('diffTolerance')?.addEventListener('input', e => {
        if (document.getElementById('diffToleranceVal')) document.getElementById('diffToleranceVal').textContent = e.target.value;
    });

    function _setDiffRunBtnReady() {
        const btn = document.getElementById('diffRunBtn');
        if (!btn) return;
        if (_diffBaseline && _diffCurrent) {
            btn.disabled = false; btn.style.background = '#f97316'; btn.style.color = '#fff'; btn.style.cursor = 'pointer';
        }
    }

    function _captureForDiff(thumbId, placeholderId, onDone) {
        const btn = arguments[3]; // caller passes button element as 4th arg
        const ORIG = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:11px;height:11px;border-width:2px;"></span> Capturing…';
        btn.disabled = true;
        captureDeviceFrame(dataUrl => {
            const thumb = document.getElementById(thumbId);
            const ph    = document.getElementById(placeholderId);
            if (thumb)  { thumb.src = dataUrl; thumb.style.display = 'block'; }
            if (ph)     ph.style.display = 'none';
            btn.innerHTML = ORIG; btn.disabled = false;
            onDone(dataUrl);
            _setDiffRunBtnReady();
            window.showGlobalAlert('Captured', 'Screenshot saved.', 'success');
        }, err => { btn.innerHTML = ORIG; btn.disabled = false; window.showGlobalAlert('Capture Failed', err, 'error'); });
    }

    document.getElementById('diffCaptureBaselineBtn')?.addEventListener('click', function() {
        _captureForDiff('diffBaselineThumb', 'diffBaselinePlaceholder', url => { _diffBaseline = url; }, this);
    });
    document.getElementById('diffCaptureCurrentBtn')?.addEventListener('click', function() {
        _captureForDiff('diffCurrentThumb', 'diffCurrentPlaceholder', url => { _diffCurrent = url; }, this);
    });

    document.getElementById('diffRunBtn')?.addEventListener('click', () => {
        if (!_diffBaseline || !_diffCurrent) return;
        const tolerance = parseInt(document.getElementById('diffTolerance')?.value) || 10;
        const runBtn = document.getElementById('diffRunBtn');
        runBtn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:11px;height:11px;border-width:2px;"></span> Computing…';
        runBtn.disabled = true;

        const bImg = new Image();
        bImg.onload = () => {
            const cImg = new Image();
            cImg.onload = () => {
                const canvas = document.getElementById('simDiffCanvas');
                const w = bImg.width, h = bImg.height;
                canvas.width = w; canvas.height = h;
                const ctx2 = canvas.getContext('2d', { willReadFrequently: true });
                ctx2.drawImage(bImg, 0, 0);
                const bd = ctx2.getImageData(0, 0, w, h);
                ctx2.clearRect(0, 0, w, h);
                ctx2.drawImage(cImg, 0, 0, w, h);
                const cd = ctx2.getImageData(0, 0, w, h);
                const dd = ctx2.createImageData(w, h);
                let diffPx = 0;
                for (let i = 0; i < bd.data.length; i += 4) {
                    const dr = Math.abs(bd.data[i]-cd.data[i]), dg = Math.abs(bd.data[i+1]-cd.data[i+1]), db2 = Math.abs(bd.data[i+2]-cd.data[i+2]);
                    if (dr > tolerance || dg > tolerance || db2 > tolerance) {
                        diffPx++; dd.data[i]=255; dd.data[i+1]=0; dd.data[i+2]=255; dd.data[i+3]=255;
                    } else {
                        const gray = bd.data[i]*.3 + bd.data[i+1]*.59 + bd.data[i+2]*.11;
                        dd.data[i]=gray; dd.data[i+1]=gray; dd.data[i+2]=gray; dd.data[i+3]=90;
                    }
                }
                ctx2.putImageData(dd, 0, 0);
                const pct = ((diffPx/(w*h))*100).toFixed(2);
                const badge = document.getElementById('diffScoreBadge');
                badge.textContent = pct > 0 ? `${pct}% pixel shift` : '✅ Pixel Perfect Match!';
                badge.style.color = pct > 5 ? '#ef4444' : pct > 1 ? 'var(--mq-warning)' : 'var(--mq-success)';
                badge.style.borderColor = badge.style.color;
                const wrap = document.getElementById('diffResultWrap');
                if (wrap) wrap.style.display = 'flex';
                runBtn.innerHTML = '<i class="bi bi-play-fill me-1"></i>Run Pixel Diff'; runBtn.disabled = false;
            };
            cImg.src = _diffCurrent;
        };
        bImg.src = _diffBaseline;
    });

    document.getElementById('diffDownloadBtn')?.addEventListener('click', () => {
        const canvas = document.getElementById('simDiffCanvas');
        if (!canvas) return;
        const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `Sim_Diff_${Date.now()}.png`; a.click();
        window.showGlobalAlert('Downloaded', 'Diff image saved.', 'success');
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // 👁️  VISION SIMULATOR
    // ═══════════════════════════════════════════════════════════════════════════════
    const SVG_MATRICES = {
        protanopia:   `<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><defs><filter id="_mqProtan"><feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0"/></filter></defs></svg>`,
        deuteranopia: `<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><defs><filter id="_mqDeutan"><feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0"/></filter></defs></svg>`,
        tritanopia:   `<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><defs><filter id="_mqTritan"><feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0"/></filter></defs></svg>`,
        achromatopsia:`<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><defs><filter id="_mqAchroma"><feColorMatrix type="saturate" values="0"/></filter></defs></svg>`,
    };
    const SVG_FILTER_IDS = { protanopia:'_mqProtan', deuteranopia:'_mqDeutan', tritanopia:'_mqTritan', achromatopsia:'_mqAchroma' };

    document.querySelectorAll('.vision-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const filterKey = btn.getAttribute('data-filter');
            // Update active style
            document.querySelectorAll('.vision-filter-btn').forEach(b => {
                const active = b.getAttribute('data-filter') === filterKey;
                b.style.borderColor = active ? '#10b981' : 'var(--mq-border-subtle)';
                b.style.color       = active ? 'var(--mq-success)' : 'var(--mq-text-2)';
            });
            if (LayoutDetector.frameId === null) { window.showGlobalAlert('No Page Loaded', 'Load a page in the simulator first.', 'warning'); return; }
            const svgHtml  = SVG_MATRICES[filterKey] || null;
            const filterId = SVG_FILTER_IDS[filterKey] || null;
            chrome.scripting.executeScript({
                target: { tabId: LayoutDetector.tabId, frameIds: [LayoutDetector.frameId] },
                func: (key, svgHtml, filterId) => {
                    document.getElementById('_mqVisionSvg')?.remove();
                    if (key === 'none') { document.documentElement.style.filter = ''; return; }
                    if (svgHtml) {
                        const wrap = document.createElement('div'); wrap.id = '_mqVisionSvg'; wrap.style.display = 'none';
                        wrap.innerHTML = svgHtml; document.body.appendChild(wrap);
                        document.documentElement.style.filter = `url(#${filterId})`;
                    } else {
                        document.documentElement.style.filter = key;
                    }
                }, args: [filterKey, svgHtml, filterId]
            }).catch(() => window.showGlobalAlert('Filter Error', 'Cross-origin pages block CSS injection.', 'warning'));
        });
    });

    // Reset vision filter when page navigates
    frame.addEventListener('load', () => {
        document.querySelectorAll('.vision-filter-btn').forEach(b => {
            b.style.borderColor = b.getAttribute('data-filter') === 'none' ? '#10b981' : 'var(--mq-border-subtle)';
            b.style.color       = b.getAttribute('data-filter') === 'none' ? 'var(--mq-success)' : 'var(--mq-text-2)';
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🏢  ENTERPRISE QA
    // ═══════════════════════════════════════════════════════════════════════════════
    const WCAG_ITEMS = [
        { id:'w1',  criterion:'1.1.1', label:'All images have descriptive alt text' },
        { id:'w2',  criterion:'1.4.1', label:'Color is not the only information conveyor' },
        { id:'w3',  criterion:'1.4.3', label:'Text contrast ratio ≥ 4.5:1 (AA standard)' },
        { id:'w4',  criterion:'1.4.4', label:'Text resizes to 200% without content loss' },
        { id:'w5',  criterion:'1.4.10', label:'Page reflows at 320px without horizontal scroll' },
        { id:'w6',  criterion:'2.1.1', label:'All functionality accessible via keyboard' },
        { id:'w7',  criterion:'2.4.2', label:'Page has a meaningful <title>' },
        { id:'w8',  criterion:'2.4.4', label:'Link text is descriptive (no "click here")' },
        { id:'w9',  criterion:'2.4.7', label:'Keyboard focus indicator is always visible' },
        { id:'w10', criterion:'2.3.1', label:'No content flashes more than 3× per second' },
        { id:'w11', criterion:'3.3.1', label:'Form inputs have clearly associated labels' },
        { id:'w12', criterion:'4.1.2', label:'All UI components have accessible names/roles' },
    ];
    const wcagChecked = {};

    const wcagListEl = document.getElementById('wcagList');
    if (wcagListEl) {
        WCAG_ITEMS.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:6px;cursor:pointer;transition:background .15s;';
            row.innerHTML = `<div id="wcag-box-${item.id}" style="width:16px;height:16px;border:2px solid var(--mq-border-subtle);border-radius:4px;flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;transition:.15s;"></div><div style="flex:1;"><div style="font-size:12px;font-weight:600;color:var(--mq-text);line-height:1.4;">${item.label}</div><div style="font-size:12px;color:var(--mq-text-2);font-weight:700;margin-top:1px;">WCAG ${item.criterion}</div></div>`;
            row.addEventListener('click', () => {
                wcagChecked[item.id] = !wcagChecked[item.id];
                const box = document.getElementById(`wcag-box-${item.id}`);
                box.style.background  = wcagChecked[item.id] ? '#10b981' : 'transparent';
                box.style.borderColor = wcagChecked[item.id] ? '#10b981' : 'var(--mq-border-subtle)';
                box.innerHTML = wcagChecked[item.id] ? '<i class="bi bi-check-lg" style="color:#fff;font-size:9px;"></i>' : '';
                const count = Object.values(wcagChecked).filter(Boolean).length;
                const scoreEl = document.getElementById('wcagScore');
                if (scoreEl) { scoreEl.textContent = `${count} / ${WCAG_ITEMS.length}`; scoreEl.style.color = count === WCAG_ITEMS.length ? 'var(--mq-success)' : count > 6 ? 'var(--mq-warning)' : 'var(--mq-text-muted)'; }
            });
            row.addEventListener('mouseenter', () => row.style.background = 'var(--mq-surface)');
            row.addEventListener('mouseleave', () => row.style.background = 'transparent');
            wcagListEl.appendChild(row);
        });
    }

    // Batch URL Tester
    function _parseBatchUrls() {
        const ta = document.getElementById('batchUrlInput');
        if (!ta) return [];
        return ta.value.split('\n').map(u => u.trim()).filter(u => u.startsWith('http://') || u.startsWith('https://'));
    }

    document.getElementById('batchRunBtn')?.addEventListener('click', () => {
        const urls = _parseBatchUrls();
        if (!urls.length) { window.showGlobalAlert('No URLs', 'Add at least one valid http(s) URL.', 'warning'); return; }
        urls.forEach(u => chrome.tabs.create({ url: chrome.runtime.getURL(`simulator.html?url=${encodeURIComponent(u)}&w=${width}&h=${height}&type=${type}&notch=${notch}&os=${os}`), active: false }));
        const s = document.getElementById('batchStatus');
        if (s) { s.style.display = 'block'; s.textContent = `✓ ${urls.length} simulator tab(s) launched.`; }
        window.showGlobalAlert('Batch Launched', `${urls.length} URLs opened in simulator tabs.`, 'success');
    });

    document.getElementById('batchSequentialBtn')?.addEventListener('click', () => {
        const urls = _parseBatchUrls();
        if (!urls.length) { window.showGlobalAlert('No URLs', 'Add at least one valid http(s) URL.', 'warning'); return; }
        let delay = 0;
        urls.forEach(u => { setTimeout(() => chrome.tabs.create({ url: chrome.runtime.getURL(`simulator.html?url=${encodeURIComponent(u)}&w=${width}&h=${height}&type=${type}&notch=${notch}&os=${os}`), active: false }), delay); delay += 1200; });
        const s = document.getElementById('batchStatus');
        if (s) { s.style.display = 'block'; s.textContent = `Launching ${urls.length} tab(s) sequentially…`; }
        window.showGlobalAlert('Sequential Batch', `Opening ${urls.length} tabs every 1.2s.`, 'info');
    });

    // Performance Scan
    document.getElementById('perfScanBtn')?.addEventListener('click', () => {
        if (LayoutDetector.frameId === null) { window.showGlobalAlert('No Page', 'Load a page in the simulator first.', 'warning'); return; }
        chrome.scripting.executeScript({
            target: { tabId: LayoutDetector.tabId, frameIds: [LayoutDetector.frameId] },
            func: () => ({ dom: document.querySelectorAll('*').length, imgs: document.images.length, scripts: document.scripts.length, noAlt: Array.from(document.images).filter(i => !i.alt || !i.alt.trim()).length })
        }).then(res => {
            if (!res?.[0]?.result) return;
            const m = res[0].result;
            document.getElementById('perfDomCount').textContent    = m.dom;
            document.getElementById('perfImgCount').textContent    = m.imgs;
            document.getElementById('perfScriptCount').textContent = m.scripts;
            const altEl = document.getElementById('perfAltMissing');
            altEl.textContent = m.noAlt;
            altEl.style.color = m.noAlt > 0 ? '#ef4444' : 'var(--mq-success)';
            window.showGlobalAlert('Scan Complete', `${m.dom} DOM nodes · ${m.noAlt} images missing alt text.`, m.noAlt > 0 ? 'warning' : 'success');
        }).catch(() => window.showGlobalAlert('Scan Failed', 'Cross-origin restriction prevents DOM access.', 'error'));
    });

    // Export Full Audit PDF
    document.getElementById('exportAuditBtn')?.addEventListener('click', async () => {
        if (typeof window.jspdf === 'undefined') { window.showGlobalAlert('Library Missing', 'jsPDF not loaded on this page.', 'error'); return; }
        const btn = document.getElementById('exportAuditBtn');
        const ORIG = btn.innerHTML; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Building…'; btn.disabled = true;

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p','mm','a4');
        const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();

        // ── Cover header
        pdf.setFillColor(15,23,42); pdf.rect(0,0,pw,46,'F');
        pdf.setTextColor(248,250,252); pdf.setFontSize(20); pdf.setFont(undefined,'bold');
        pdf.text('ENTERPRISE QA AUDIT REPORT', 15, 22);
        pdf.setFontSize(9); pdf.setFont(undefined,'normal'); pdf.setTextColor(148,163,184);
        pdf.text(`URL: ${targetUrl}`, 15, 30);
        pdf.text(`Device: ${width}×${height}  ${type.toUpperCase()} / ${os.toUpperCase()}`, 15, 36);
        pdf.text(`Generated: ${new Date().toLocaleString()}  ·  Marquis QA Simulator`, 15, 42);

        // ── WCAG
        let y = 58;
        pdf.setTextColor(99,102,241); pdf.setFontSize(13); pdf.setFont(undefined,'bold');
        pdf.text('WCAG 2.1 CHECKLIST', 15, y); y += 9;
        pdf.setFontSize(10); pdf.setFont(undefined,'normal');
        WCAG_ITEMS.forEach(item => {
            const ok = !!wcagChecked[item.id];
            pdf.setTextColor(ok ? 16 : 239, ok ? 185 : 68, ok ? 129 : 68);
            pdf.text(`${ok ? '✓' : '✗'}  [${item.criterion}]  ${item.label}`, 18, y); y += 7;
            if (y > ph - 15) { pdf.addPage(); y = 20; }
        });

        // ── Layout Issues
        if (LayoutDetector.issues?.length > 0) {
            pdf.addPage(); y = 20;
            pdf.setTextColor(245,158,11); pdf.setFontSize(13); pdf.setFont(undefined,'bold');
            pdf.text(`LAYOUT ISSUES  (${LayoutDetector.issues.length} found)`, 15, y); y += 10;
            pdf.setFontSize(9); pdf.setFont(undefined,'normal');
            LayoutDetector.issues.forEach(issue => {
                const c = issue.severity==='error'?[239,68,68]:issue.severity==='warning'?[245,158,11]:[59,130,246];
                pdf.setTextColor(...c); pdf.setFont(undefined,'bold');
                const tLines = pdf.splitTextToSize(`[${issue.severity.toUpperCase()}]  ${issue.title}`, pw-30);
                pdf.text(tLines, 15, y); y += tLines.length*5+2;
                pdf.setFont(undefined,'normal'); pdf.setTextColor(100,116,139);
                const dLines = pdf.splitTextToSize(issue.description, pw-32);
                pdf.text(dLines, 19, y); y += dLines.length*5+2;
                if (issue.fix) {
                    pdf.setTextColor(16,185,129);
                    const fLines = pdf.splitTextToSize(`Fix: ${issue.fix}`, pw-32);
                    pdf.text(fLines, 19, y); y += fLines.length*5+4;
                } else { y += 3; }
                if (y > ph-15) { pdf.addPage(); y = 20; }
            });
        }

        // ── Performance
        const domVal = document.getElementById('perfDomCount')?.textContent;
        if (domVal && domVal !== '—') {
            pdf.addPage(); y = 20;
            pdf.setTextColor(99,102,241); pdf.setFontSize(13); pdf.setFont(undefined,'bold');
            pdf.text('PAGE METRICS', 15, y); y += 10;
            pdf.setFontSize(10); pdf.setFont(undefined,'normal'); pdf.setTextColor(40,40,40);
            [`DOM Nodes: ${domVal}`, `Images: ${document.getElementById('perfImgCount')?.textContent}`, `Scripts: ${document.getElementById('perfScriptCount')?.textContent}`, `Images missing alt text: ${document.getElementById('perfAltMissing')?.textContent}`].forEach(line => { pdf.text(line, 18, y); y += 8; });
        }

        // ── Page numbers & footer
        const pages = pdf.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            pdf.setPage(i);
            pdf.setDrawColor(51,65,85); pdf.line(15, ph-14, pw-15, ph-14);
            pdf.setFontSize(8); pdf.setTextColor(100,116,139);
            pdf.text('Marquis Enterprise QA Simulator', 15, ph-9);
            pdf.text(`Page ${i} of ${pages}`, pw-28, ph-9);
        }

        pdf.save(`Enterprise_QA_Audit_${Date.now()}.pdf`);
        btn.innerHTML = ORIG; btn.disabled = false;
        window.showGlobalAlert('Audit Exported', 'Enterprise QA PDF downloaded successfully.', 'success');
    });

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🚀 PAGESPEED INSIGHTS (GOOGLE API)
    // ═══════════════════════════════════════════════════════════════════════════════
    let psiActiveStrategy = 'MOBILE';

    // Handle Mobile/Desktop Tab Switching
    document.querySelectorAll('.psi-strategy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.psi-strategy-btn').forEach(b => {
                b.style.background = 'transparent';
                b.style.color = 'var(--mq-text-2)';
                b.classList.remove('active');
            });
            const target = e.currentTarget;
            target.style.background = '#0ea5e9';
            target.style.color = '#fff';
            target.classList.add('active');
            psiActiveStrategy = target.getAttribute('data-strategy');
        });
    });

    // 🟢 Load saved API Key on boot
    const psiApiKeyInput = document.getElementById('psiApiKey');
    if (psiApiKeyInput && typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['psiApiKey'], (res) => {
            if (res.psiApiKey) psiApiKeyInput.value = res.psiApiKey;
        });
        // Auto-save key when user types it
        psiApiKeyInput.addEventListener('change', (e) => {
            chrome.storage.local.set({ psiApiKey: e.target.value.trim() });
        });
    }

    document.getElementById('psiRunBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('psiRunBtn');
        const container = document.getElementById('psiResultsContainer');
        const urlToTest = document.getElementById('simUrl').value || targetUrl;
        const apiKey = document.getElementById('psiApiKey')?.value.trim();

        // Guard against internal URLs
        if (isRestrictedUrl(urlToTest) || urlToTest.includes('localhost') || urlToTest.includes('127.0.0.1')) {
            window.showGlobalAlert('Invalid URL', 'Google PageSpeed Insights can only analyze publicly accessible, live web URLs.', 'error');
            return;
        }

        const ORIG_HTML = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Analyzing... (Takes ~10s)';
        btn.disabled = true;
        container.style.display = 'none';

        try {
            // 🟢 Add API Key to endpoint if provided
            const keyParam = apiKey ? `&key=${apiKey}` : '';
            const apiEndpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(urlToTest)}&strategy=${psiActiveStrategy}&category=PERFORMANCE&category=ACCESSIBILITY&category=BEST_PRACTICES&category=SEO${keyParam}`;
            
            const response = await fetch(apiEndpoint);
            const data = await response.json();

            // 🟢 Handle Quota Errors gracefully
            if (data.error) {
                if (data.error.message.includes('Quota exceeded')) {
                    throw new Error("API Quota Exceeded. Please enter a valid Google API Key to continue.");
                }
                throw new Error(data.error.message);
            }

            const lighthouse = data.lighthouseResult;
            
            // 1. Render Scores
            const renderScore = (idPrefix, scoreDec) => {
                const score = Math.round(scoreDec * 100);
                const color = score >= 90 ? '#10b981' : (score >= 50 ? '#f59e0b' : '#ef4444');
                document.getElementById(`${idPrefix}Score`).innerText = score;
                document.getElementById(`${idPrefix}Score`).style.color = color;
                document.getElementById(`${idPrefix}Circle`).style.background = `conic-gradient(${color} ${score}%, #334155 0)`;
            };

            renderScore('psiPerf', lighthouse.categories.performance.score);
            renderScore('psiAccess', lighthouse.categories.accessibility.score);
            renderScore('psiBest', lighthouse.categories['best-practices'].score);
            renderScore('psiSeo', lighthouse.categories.seo.score);

            // 2. Render Lab Metrics
            const metricsList = document.getElementById('psiMetricsList');
            metricsList.innerHTML = '';
            
            const metricsToPull = [
                { id: 'first-contentful-paint', name: 'First Contentful Paint' },
                { id: 'largest-contentful-paint', name: 'Largest Contentful Paint' },
                { id: 'total-blocking-time', name: 'Total Blocking Time' },
                { id: 'cumulative-layout-shift', name: 'Cumulative Layout Shift' },
                { id: 'speed-index', name: 'Speed Index' }
            ];

            metricsToPull.forEach(m => {
                const audit = lighthouse.audits[m.id];
                if (!audit) return;
                const score = audit.score;
                const color = score >= 0.9 ? '#10b981' : (score >= 0.5 ? '#f59e0b' : '#ef4444');
                
                metricsList.innerHTML += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:var(--mq-sunken); border:1px solid var(--mq-border-subtle); border-radius:6px;">
                        <span style="font-size:12px; color:var(--mq-text-2); font-weight:600;">
                            <i class="bi bi-circle-fill me-2" style="font-size:8px; color:${color};"></i>${m.name}
                        </span>
                        <span style="font-size:12px; font-weight:800; font-family:monospace; color:${color};">${MarquisHtml.esc(audit.displayValue)}</span>
                    </div>`;
            });

            // 3. Render Opportunities (Diagnostics)
            const oppList = document.getElementById('psiOpportunitiesList');
            oppList.innerHTML = '';
            
            const opportunities = Object.values(lighthouse.audits)
                .filter(audit => audit.details && audit.details.type === 'opportunity' && audit.score < 1)
                .sort((a, b) => (b.details.overallSavingsMs || 0) - (a.details.overallSavingsMs || 0));

            if (opportunities.length === 0) {
                oppList.innerHTML = '<div style="text-align:center; padding:10px; font-size:12px; color:var(--mq-success);"><i class="bi bi-check-circle-fill me-1"></i> No major performance bottlenecks detected!</div>';
            } else {
                opportunities.forEach(opp => {
                    oppList.innerHTML += `
                        <div style="padding:10px; background:var(--mq-sunken); border:1px solid var(--mq-border-subtle); border-radius:6px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                                <span style="font-size:12px; font-weight:700; color:var(--mq-danger);">${MarquisHtml.esc(opp.title)}</span>
                                <span style="font-size:12px; font-weight:700; color:var(--mq-warning); background:#f59e0b20; padding:2px 6px; border-radius:4px; white-space:nowrap;">Save ${MarquisHtml.esc(opp.displayValue)}</span>
                            </div>
                            <div style="font-size:12px; color:var(--mq-text-muted); line-height:1.4;">${MarquisHtml.esc(opp.description.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'))}</div>
                        </div>`;
                });
            }

            container.style.display = 'flex';
            window.showGlobalAlert('Analysis Complete', `PageSpeed Insights generated successfully for ${psiActiveStrategy}.`, 'success');

        } catch (err) {
            console.error(err);
            window.showGlobalAlert('PageSpeed Error', err.message || 'Failed to fetch Google Lighthouse data.', 'error');
        } finally {
            btn.innerHTML = ORIG_HTML;
            btn.disabled = false;
        }
    });
});