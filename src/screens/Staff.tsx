import { useEffect, useState } from "react";
import { allEvents, eventCounts } from "../lib/analytics";
import { allProfiles } from "../lib/profile";
import { listGallery, type GalleryItem } from "../lib/gallery";

// Hidden staff panel (open: tap the logo 5x). Booth dashboard:
// today's counts, monster archive, full data export, reset for the next child.
export function Staff({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const counts = eventCounts();

  useEffect(() => {
    listGallery().then(setGallery);
  }, []);

  function exportAll() {
    const payload = {
      exportedAt: new Date().toISOString(),
      profiles: allProfiles(),
      events: allEvents(),
      gallery: gallery.map(({ photo, ...meta }) => meta), // metadata only (images stay on device)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monggle-booth-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const KEY_METRICS: [string, string][] = [
    ["profile_created", "Profiles"],
    ["clay_success", "Clay OK"],
    ["wake_success", "Wake OK"],
    ["quest_win", "Quests done"],
    ["booth_snap", "Photos"],
    ["cert_saved", "Certs saved"],
  ];

  return (
    <div className="staff">
      <div className="staff-head">
        <h2>🛠️ Staff panel</h2>
        <button className="btn-secondary" onClick={onClose}>Close</button>
      </div>

      <div className="staff-stats">
        {KEY_METRICS.map(([k, label]) => (
          <div key={k} className="stat">
            <span className="stat-n">{counts[k] ?? 0}</span>
            <span className="stat-l">{label}</span>
          </div>
        ))}
      </div>

      <div className="staff-actions">
        <button className="btn-primary" onClick={onReset}>🔄 Reset for next child</button>
        <button className="btn-secondary" onClick={exportAll}>⬇️ Export data (JSON)</button>
      </div>

      <h3>🥦 Monster archive ({gallery.length})</h3>
      <div className="staff-gallery">
        {gallery.map((g) => (
          <figure key={g.id} className="staff-item">
            <img src={g.photo} alt={g.name} />
            <figcaption>
              {g.name}
              {g.traits.length > 0 && <small>{g.traits.join(" · ")}</small>}
            </figcaption>
          </figure>
        ))}
        {gallery.length === 0 && <p className="muted">No monsters yet today.</p>}
      </div>
    </div>
  );
}
