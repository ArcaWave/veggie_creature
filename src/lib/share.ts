// Share-or-download for keepsakes. On iPad/iPhone the native share sheet opens
// (AirDrop, Mail, Messages, Save Image/Video…); elsewhere it downloads the file.
export async function shareOrDownload(dataUrl: string, filename: string, title: string) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share?.({ files: [file], title });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    /* user cancelled the sheet — fine */
  }
}

export const fileSlug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "monster";
