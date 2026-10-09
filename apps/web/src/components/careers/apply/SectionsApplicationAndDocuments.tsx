"use client";

import { TextAreaField } from "@/components/forms/Fields";
import { careersConfig } from "@/lib/careers-config";
import { fileLimitsSummary } from "@/lib/careers";
import { FileTotal, SingleFileField, SupportingFiles, type SupportingItem } from "./FileFields";
import styles from "./apply.module.css";
import type { SectionProps } from "./types";

/**
 * Sections 5 and 6 of the application: the CV, the cover letter (a file, pasted text, or both), the short
 * answers, and the optional supporting documents, where identity and right-to-work documents may be
 * uploaded for now. The files are held in memory by the form and sent with it; nothing is stored.
 */
export interface FilesProps {
  cv: File | null;
  coverFile: File | null;
  cvError?: string;
  coverError?: string;
  onCv: (file: File | null) => void;
  onCover: (file: File | null) => void;
  announce: (message: string) => void;
}

export function YourApplication({ values, set, errors, cv, coverFile, cvError, coverError, onCv, onCover, announce }: SectionProps & FilesProps) {
  const { limits } = careersConfig;
  return (
    <div className={styles.stack}>
      <SingleFileField name="cv" slot="cv" label="Your CV" file={cv} error={cvError} onChange={onCv} announce={announce} hint={fileLimitsSummary()} />
      <SingleFileField name="coverLetterFile" slot="coverLetterFile" label="Cover letter file" optional file={coverFile} error={coverError} onChange={onCover} announce={announce} />
      <TextAreaField
        name="coverLetterText"
        label="Or paste your cover letter here"
        optional
        hint="You can upload a file, paste text, or do both."
        value={values.coverLetterText}
        onChange={(v) => set("coverLetterText", v)}
        error={errors.coverLetterText}
        rows={8}
        maxLength={limits.coverLetterTextMax}
        counter
        full
      />
      <TextAreaField
        name="whyTutor"
        label="Why do you want to tutor with LearnThrive?"
        hint={`A few sentences are fine. At least ${limits.whyTutorMin} characters.`}
        value={values.whyTutor}
        onChange={(v) => set("whyTutor", v)}
        error={errors.whyTutor}
        rows={5}
        maxLength={limits.shortAnswerMax}
        counter
        full
      />
      <TextAreaField
        name="stuckLearner"
        label="A learner still does not understand a topic after two explanations. What do you do?"
        optional
        value={values.stuckLearner}
        onChange={(v) => set("stuckLearner", v)}
        error={errors.stuckLearner}
        rows={5}
        maxLength={limits.shortAnswerMax}
        counter
        full
      />
    </div>
  );
}

export interface SupportingProps {
  items: readonly SupportingItem[];
  errors: Readonly<Record<string, string>>;
  totalBytes: number;
  totalError?: string;
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
  onType: (id: string, type: string) => void;
  announce: (message: string) => void;
}

export function SupportingDocuments({ items, errors, totalBytes, totalError, onAdd, onRemove, onType, announce }: SupportingProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.privateNote}>
        <p>
          <strong>This is where you can upload your identity and right-to-work documents for now, until we put a separate secure process in place.</strong>{" "}
          Uploading them now is optional: you can provide them later, when we ask.
        </p>
        <p>
          Only upload what is needed, and do not send bank details, health information or anything else personal. We use identity and right-to-work
          documents to verify who you are and that you can work in the UK. The hiring team handles them. If you work with LearnThrive they are kept
          while you do and for 12 months after, so you do not have to start again if you return, then deleted; if your application is unsuccessful they
          are deleted {careersConfig.unsuccessfulRetentionMonths} months after the decision.
        </p>
        <p>
          <strong>Do not upload a DBS certificate.</strong> The DBS check is arranged separately, through the DBS process.
        </p>
      </div>
      <SupportingFiles items={items} errors={errors} onAdd={onAdd} onRemove={onRemove} onType={onType} announce={announce} />
      <FileTotal total={totalBytes} error={totalError} />
    </div>
  );
}
