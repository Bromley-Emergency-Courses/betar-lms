"use client";

import Image from "next/image";
import { useState } from "react";
import { createPortal } from "react-dom";

export function StudentProfilePhoto({
  studentId,
  studentName,
  initials,
  hasPhoto
}: {
  studentId: string;
  studentName: string;
  initials: string;
  hasPhoto: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const photoSrc = `/api/students/${studentId}/photo`;
  const overlay = (
    <button className="profile-photo-overlay" type="button" onClick={() => setExpanded(false)} aria-label="Close profile photo">
      <span className="profile-photo-expanded">
        {hasPhoto ? (
          <Image src={photoSrc} alt={`${studentName} profile photo`} width={520} height={520} unoptimized />
        ) : (
          <span>{initials}</span>
        )}
      </span>
    </button>
  );

  return (
    <>
      <button
        className="profile-photo-thumb"
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`View ${studentName} profile photo`}
      >
        {hasPhoto ? (
          <Image src={photoSrc} alt={`${studentName} profile photo`} width={48} height={48} unoptimized />
        ) : (
          <span>{initials}</span>
        )}
      </button>
      {expanded && typeof document !== "undefined" ? createPortal(overlay, document.body) : null}
    </>
  );
}
