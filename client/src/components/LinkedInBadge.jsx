import React from "react";
import { LinkedInIcon } from "./ui";

export default function LinkedInBadge({ url, size = 50 }) {
  if (!url) return null;
  const fullUrl = url.startsWith("http") ? url : `https://linkedin.com/in/${url}`;
  return (
    <div className="flex items-center gap-2 mt-2">
      <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-xs">
        <LinkedInIcon size={12} /> Profile
      </a>
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(fullUrl)}&bgcolor=FFFFFF&color=0A66C2&margin=4`}
        alt="LinkedIn QR"
        className="rounded"
        style={{ width: size, height: size }}
      />
    </div>
  );
}
