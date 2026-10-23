/* Minimal provider fixture. These tests exercise application state and commands,
   while real Google Maps rendering is checked separately in localhost inspection. */
(() => {
  const listeners = new WeakMap();
  const event = {
    addListener(target, name, callback) {
      const list = listeners.get(target) ?? new Map();
      const callbacks = list.get(name) ?? new Set();
      callbacks.add(callback); list.set(name, callbacks); listeners.set(target, list);
      return { remove: () => callbacks.delete(callback) };
    },
    removeListener(listener) { listener?.remove(); },
    trigger(target, name, ...args) { for (const callback of listeners.get(target)?.get(name) ?? []) callback(...args); },
    clearInstanceListeners(target) { listeners.delete(target); },
  };
  class LatLng {
    constructor(lat, lng) { this.latitude = typeof lat === "object" ? (typeof lat.lat === "function" ? lat.lat() : lat.lat) : lat; this.longitude = typeof lat === "object" ? (typeof lat.lng === "function" ? lat.lng() : lat.lng) : lng; }
    lat() { return this.latitude; }
    lng() { return this.longitude; }
    toJSON() { return { lat: this.lat(), lng: this.lng() }; }
    equals(other) { return other?.lat() === this.lat() && other?.lng() === this.lng(); }
  }
  class LatLngBounds {
    constructor(southwest, northeast) { this.points = []; if (southwest) this.extend(southwest); if (northeast) this.extend(northeast); }
    extend(point) { this.points.push(new LatLng(point)); return this; }
    getSouthWest() { return new LatLng(Math.min(...this.points.map((point) => point.lat())), Math.min(...this.points.map((point) => point.lng()))); }
    getNorthEast() { return new LatLng(Math.max(...this.points.map((point) => point.lat())), Math.max(...this.points.map((point) => point.lng()))); }
    getCenter() { const sw = this.getSouthWest(), ne = this.getNorthEast(); return new LatLng((sw.lat() + ne.lat()) / 2, (sw.lng() + ne.lng()) / 2); }
    contains() { return true; }
  }
  const state = { calls: [], markers: [], map: null };
  window.__mapsMock = state;
  class MapFixture {
    constructor(div, options) { this.div = div; this.zoom = options.zoom ?? 2; this.center = new LatLng(options.center ?? { lat: 0, lng: 0 }); this.offset = 0; state.map = this; div.dataset.mockMap = "true"; }
    getDiv() { return this.div; }
    setOptions() {}
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = zoom; state.calls.push({ action: "zoom", zoom }); this.idle(); }
    getCenter() { return this.center; }
    setCenter(point) { this.center = new LatLng(point); this.offset = 0; state.calls.push({ action: "center", point: this.center.toJSON() }); this.idle(); }
    panTo(point) { this.setCenter(point); }
    panBy(x, y) { this.offset += y; state.calls.push({ action: "panBy", x, y }); this.idle(); }
    fitBounds(bounds) { const sw = bounds.getSouthWest(), ne = bounds.getNorthEast(); this.center = bounds.getCenter(); this.zoom = Math.min(17, Math.floor(Math.log2(360 / Math.max(ne.lat() - sw.lat(), ne.lng() - sw.lng(), .002))) - 1); this.offset = 0; state.calls.push({ action: "fit", count: bounds.points.length }); this.idle(); }
    getProjection() { return {}; }
    getBounds() { return new LatLngBounds({ lat: -90, lng: -180 }, { lat: 90, lng: 180 }); }
    addListener(name, callback) { return event.addListener(this, name, callback); }
    idle() { queueMicrotask(() => { event.trigger(this, "idle"); state.markers.forEach((marker) => marker.draw()); }); }
  }
  class Marker {
    constructor(options = {}) { this.position = new LatLng(options.position ?? { lat: 0, lng: 0 }); this.visible = true; this.button = document.createElement("button"); this.button.type = "button"; this.button.dataset.mockMarker = "true"; this.button.style.cssText = "position:absolute;width:18px;height:18px;min-height:18px;border-radius:50%;padding:0;border:2px solid white;background:#48677f"; this.button.onclick = (e) => { e.stopPropagation(); event.trigger(this, "click", e); }; state.markers.push(this); this.setTitle(options.title ?? ""); if (options.map) this.setMap(options.map); }
    setMap(map) { this.map = map; if (map) map.getDiv().append(this.button); else this.button.remove(); this.draw(); }
    getMap() { return this.map; }
    getPosition() { return this.position; }
    setPosition(position) { this.position = new LatLng(position); this.draw(); }
    getVisible() { return this.visible; }
    setVisible(visible) { this.visible = visible; this.draw(); }
    setTitle(title) { this.button.title = title; this.button.setAttribute("aria-label", title); }
    setZIndex(value) { this.button.style.zIndex = value; }
    setIcon() {}
    setLabel() {}
    setAnimation() {}
    setOptions() {}
    addListener(name, callback) { return event.addListener(this, name, callback); }
    draw() { if (!this.map) return; const scale = 2 ** this.map.zoom / 360 * 256; this.button.style.left = `${this.map.div.clientWidth / 2 + (this.position.lng() - this.map.center.lng()) * scale - 9}px`; this.button.style.top = `${this.map.div.clientHeight / 2 - (this.position.lat() - this.map.center.lat()) * scale - this.map.offset - 9}px`; this.button.style.display = this.visible ? "block" : "none"; }
  }
  function OverlayView() {}
  // The clusterer copies enumerable prototype functions from OverlayView.
  OverlayView.prototype.setMap = function(map) { if (this.map === map) return; if (this.map) this.onRemove?.(); this.map = map; if (map) this.onAdd?.(); };
  OverlayView.prototype.getMap = function() { return this.map; };
  OverlayView.prototype.getProjection = function() { return {}; };
  OverlayView.prototype.addListener = function(name, callback) { return event.addListener(this, name, callback); };
  window.google = { maps: { version: "fixture", Map: MapFixture, Marker, LatLng, LatLngBounds, OverlayView, event, SymbolPath: { CIRCLE: "circle" }, importLibrary: async () => window.google.maps } };
})();
