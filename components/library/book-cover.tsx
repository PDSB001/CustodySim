"use client"

import { useState } from "react"
import { BookOpen } from "lucide-react"
import type { BookInfo } from "./library-types"
import styles from "./library.module.css"

export function BookCover({
  book,
  className = "",
}: {
  book: BookInfo
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = book.coverUrl
  return (
    <div className={`${styles.bookCover} ${className}`}>
      {url && failedUrl !== url ? (
        // Private images use the authenticated cover endpoint directly.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`${book.title}封面`}
          loading="lazy"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <div className={styles.noCover}>
          <BookOpen aria-hidden="true" />
          <span>暂无封面</span>
        </div>
      )}
    </div>
  )
}
