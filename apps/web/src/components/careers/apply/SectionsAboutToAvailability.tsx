"use client";

import Link from "next/link";
import { CheckboxField, CheckboxGroup, RadioGroup, SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import forms from "@/components/forms/forms.module.css";
import {
  AVAILABILITY_CHOICES,
  DBS_STATUS_CHOICES,
  EXPERIENCE_LEVEL_CHOICES,
  HOURS_CHOICES,
  QUALIFICATION_CHOICES,
  RIGHT_TO_WORK_CHOICES,
  SUBJECT_CHOICES,
  TUTORING_EXPERIENCE_CHOICES,
  YEAR_GROUP_CHOICES,
} from "@/lib/careers-validation";
import { careersConfig } from "@/lib/careers-config";
import styles from "./apply.module.css";
import type { SectionProps } from "./types";

/**
 * Sections 1 to 4 of the application: about you, the role, experience and results, availability and set-up.
 * Presentational: the form owns the state and the validation. Nothing here asks for a date of birth, a
 * photograph, nationality, marital status, health or disability information, or anything about convictions.
 */
export function AboutYou({ values, set, errors }: SectionProps) {
  return (
    <div className={forms.grid}>
      <TextField name="firstName" label="First name" value={values.firstName} onChange={(v) => set("firstName", v)} error={errors.firstName} autoComplete="given-name" maxLength={60} />
      <TextField name="lastName" label="Last name" value={values.lastName} onChange={(v) => set("lastName", v)} error={errors.lastName} autoComplete="family-name" maxLength={60} />
      <TextField name="email" label="Email address" type="email" inputMode="email" value={values.email} onChange={(v) => set("email", v)} error={errors.email} autoComplete="email" maxLength={160} />
      <TextField name="phone" label="Phone number" type="tel" inputMode="tel" value={values.phone} onChange={(v) => set("phone", v)} error={errors.phone} autoComplete="tel" maxLength={25} />
      <TextField name="town" label="Town or city" value={values.town} onChange={(v) => set("town", v)} error={errors.town} autoComplete="address-level2" maxLength={80} full />
      <div className={forms.full}>
        <CheckboxField name="over18" checked={values.over18} onChange={(on) => set("over18", on)} error={errors.over18} label={`I confirm that I am ${careersConfig.minimumAge} or over.`} />
      </div>
    </div>
  );
}

export function TheRole({ values, set, errors, roles }: SectionProps & { roles: ReadonlyArray<{ slug: string; title: string }> }) {
  return (
    <div className={styles.stack}>
      <SelectField
        name="role"
        label="Role you are applying for"
        value={values.role}
        onChange={(v) => set("role", v)}
        error={errors.role}
        options={roles.map((role) => ({ value: role.slug, label: role.title }))}
        placeholder="Choose a role"
        full
      />
      <CheckboxGroup name="subjects" legend="Subjects you could teach" options={SUBJECT_CHOICES} values={values.subjects} onChange={(v) => set("subjects", v)} error={errors.subjects} />
      <CheckboxGroup name="yearGroups" legend="Year groups you could teach" options={YEAR_GROUP_CHOICES} values={values.yearGroups} onChange={(v) => set("yearGroups", v)} error={errors.yearGroups} />
      <TextField
        name="examBoards"
        label="Exam boards or 11+ formats you are comfortable with"
        optional
        value={values.examBoards}
        onChange={(v) => set("examBoards", v)}
        error={errors.examBoards}
        maxLength={300}
        full
      />
      <TextField
        name="otherSubjects"
        label="Other subjects you could teach that we do not offer yet"
        optional
        hint="This helps us match tutors to the subjects families ask us for."
        value={values.otherSubjects}
        onChange={(v) => set("otherSubjects", v)}
        error={errors.otherSubjects}
        maxLength={200}
        full
      />
    </div>
  );
}

export function ExperienceAndResults({ values, set, errors }: SectionProps) {
  const box = (name: "gcse" | "aLevel" | "undergraduate" | "postgraduate", label: string, hint: string, optional = false) => (
    <TextAreaField
      name={name}
      label={label}
      optional={optional}
      hint={hint}
      value={values[name]}
      onChange={(v) => set(name, v)}
      error={errors[name]}
      rows={3}
      maxLength={careersConfig.limits.resultsBoxMax}
      full
    />
  );
  return (
    <div className={styles.stack}>
      <div className={forms.grid}>
        <SelectField name="highestQualification" label="Highest relevant qualification" value={values.highestQualification} onChange={(v) => set("highestQualification", v)} error={errors.highestQualification} options={QUALIFICATION_CHOICES} />
        <TextField name="qualificationSubject" label="Subject of that qualification" value={values.qualificationSubject} onChange={(v) => set("qualificationSubject", v)} error={errors.qualificationSubject} maxLength={100} />
      </div>

      <h3 className={styles.subheading}>Your results</h3>
      <p className={styles.flush}>
        Fill in at least one box. We look at your results at every level together, and a strong later result is taken into account even if an earlier one
        was weaker. Give the results in the subjects you want to teach.
      </p>
      {errors.results ? (
        <span className="field-error" id="field-results-error">
          {errors.results}
        </span>
      ) : null}
      {box("gcse", "GCSE results", "For example: Maths 9, English Language 7, Chemistry 8.")}
      {box("aLevel", "A Level results", "For example: Maths A*, Further Maths A, Physics B.")}
      {box("undergraduate", "Undergraduate degree", "The subject, the university, and your classification or expected classification.")}
      {box("postgraduate", "Postgraduate or higher degree", "The subject, the university and the level, if you have one.", true)}
      <TextAreaField
        name="resultsNote"
        label="Anything you would like us to know about your results"
        optional
        value={values.resultsNote}
        onChange={(v) => set("resultsNote", v)}
        error={errors.resultsNote}
        rows={3}
        maxLength={careersConfig.limits.resultsBoxMax}
        full
      />

      <h3 className={styles.subheading}>Your experience</h3>
      <div className={forms.grid}>
        <SelectField name="yearsTutoring" label="Tutoring or teaching experience" value={values.yearsTutoring} onChange={(v) => set("yearsTutoring", v)} error={errors.yearsTutoring} options={TUTORING_EXPERIENCE_CHOICES} />
        <SelectField name="onlineExperience" label="Experience teaching online" value={values.onlineExperience} onChange={(v) => set("onlineExperience", v)} error={errors.onlineExperience} options={EXPERIENCE_LEVEL_CHOICES} />
        <SelectField
          name="additionalNeeds"
          label="Experience supporting learners with additional needs"
          hint="This means your professional or voluntary experience, not your own health."
          value={values.additionalNeeds}
          onChange={(v) => set("additionalNeeds", v)}
          error={errors.additionalNeeds}
          options={EXPERIENCE_LEVEL_CHOICES}
          full
        />
      </div>
      <TextAreaField
        name="otherRelevant"
        label="Anything else relevant, such as other training or courses"
        optional
        value={values.otherRelevant}
        onChange={(v) => set("otherRelevant", v)}
        error={errors.otherRelevant}
        rows={3}
        maxLength={careersConfig.limits.resultsBoxMax}
        full
      />
    </div>
  );
}

export function AvailabilityAndSetup({ values, set, errors, today }: SectionProps & { today: string }) {
  return (
    <div className={styles.stack}>
      <CheckboxGroup name="times" legend="When you could teach" options={AVAILABILITY_CHOICES} values={values.times} onChange={(v) => set("times", v)} error={errors.times} />
      <div className={forms.grid}>
        <SelectField name="hoursPerWeek" label="Hours a week you could teach" value={values.hoursPerWeek} onChange={(v) => set("hoursPerWeek", v)} error={errors.hoursPerWeek} options={HOURS_CHOICES} hint="Hours depend on student availability." />
        <TextField name="startDate" label="Earliest date you could start" type="date" value={values.startDate} onChange={(v) => set("startDate", v)} error={errors.startDate} min={today} />
      </div>
      <CheckboxField
        name="privateSpace"
        checked={values.privateSpace}
        onChange={(on) => set("privateSpace", on)}
        error={errors.privateSpace}
        label="I can teach from a quiet, private space, with reliable internet, a working camera and a working microphone."
      />
      <RadioGroup
        name="rightToWork"
        legend="Are you legally able to work in the UK, including for self-employed work?"
        options={RIGHT_TO_WORK_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
        value={values.rightToWork}
        onChange={(v) => set("rightToWork", v)}
        error={errors.rightToWork}
      />

      <h3 className={styles.subheading}>Your DBS status (optional)</h3>
      <p className={styles.flush}>
        Tell us only whether you already hold a certificate. This is a status question. Please do not upload a DBS certificate or send any DBS
        information in this form: the check is handled separately, through the DBS process. See{" "}
        <Link href="/careers#faq-heading">what counts as a suitable certificate</Link>.
      </p>
      <div className={forms.grid}>
        <SelectField
          name="dbsCertificate"
          label="Do you hold an Enhanced DBS certificate that includes the Children’s Barred List?"
          optional
          value={values.dbsCertificate}
          onChange={(v) => set("dbsCertificate", v)}
          error={errors.dbsCertificate}
          options={DBS_STATUS_CHOICES}
          placeholder="Choose an answer"
        />
        <SelectField
          name="dbsUpdateService"
          label="Are you subscribed to the DBS Update Service?"
          optional
          value={values.dbsUpdateService}
          onChange={(v) => set("dbsUpdateService", v)}
          error={errors.dbsUpdateService}
          options={DBS_STATUS_CHOICES}
          placeholder="Choose an answer"
        />
      </div>
    </div>
  );
}
