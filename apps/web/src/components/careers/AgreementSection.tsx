"use client";

import { useState, type ReactNode } from "react";
import { CheckboxField, fieldId, RadioGroup, TextField } from "@/components/forms/Fields";
import { checkUnderstanding, type SafeguardingAgreement } from "@/lib/safeguarding-agreement";
import { AgreementIntro, AgreementPartView } from "./AgreementDocument";
import applyStyles from "./apply/apply.module.css";

/**
 * The agreement inside a form (the application's Section 7, and the yearly reconfirmation page): the whole
 * text on the page, not behind a link; a required tick-box under every part; the six-question understanding
 * check when it is switched on; and a typed full name as the confirmation. It reads the agreement through
 * the shared module, so what is agreed is exactly what the public page shows.
 *
 * The understanding check is not training. All six must be right; a wrong answer says which question to
 * look at again without giving the answer, and there is no limit on tries. Nothing about attempts is kept.
 */
interface Props {
  agreement: SafeguardingAgreement;
  agreedParts: readonly string[];
  onAgreedParts: (parts: string[]) => void;
  understandingRequired: boolean;
  understanding: Readonly<Record<string, string>>;
  onUnderstanding: (answers: Record<string, string>) => void;
  typedName: string;
  onTypedName: (value: string) => void;
  typedNameLabel: string;
  typedNameHint: ReactNode;
  errors: { agreedParts?: string; understanding?: string; typedName?: string };
}

export function AgreementSection({
  agreement,
  agreedParts,
  onAgreedParts,
  understandingRequired,
  understanding,
  onUnderstanding,
  typedName,
  onTypedName,
  typedNameLabel,
  typedNameHint,
  errors,
}: Props) {
  const [checked, setChecked] = useState(false);
  const result = checked ? checkUnderstanding(agreement, understanding) : null;
  const numberOf = (id: string) => agreement.understanding.findIndex((question) => question.id === id) + 1;

  return (
    <div className={applyStyles.stack}>
      <div>
        <AgreementIntro agreement={agreement} />
      </div>

      <div id={fieldId("agreedParts")} tabIndex={-1} aria-describedby={errors.agreedParts ? `${fieldId("agreedParts")}-error` : undefined}>
        {agreement.parts.map((part) => (
          <AgreementPartView
            key={part.id}
            part={part}
            idPrefix="agreement"
            footer={
              <div className={applyStyles.partFooter}>
                <CheckboxField
                  name={`agreedPart-${part.id}`}
                  checked={agreedParts.includes(part.id)}
                  onChange={(on) => onAgreedParts(on ? [...agreedParts.filter((id) => id !== part.id), part.id] : agreedParts.filter((id) => id !== part.id))}
                  label={
                    <>
                      I have read and agree to every clause in Part {part.id}: {part.heading}
                    </>
                  }
                />
              </div>
            }
          />
        ))}
        {errors.agreedParts ? (
          <span className="field-error" id={`${fieldId("agreedParts")}-error`}>
            {errors.agreedParts}
          </span>
        ) : null}
      </div>

      {understandingRequired ? (
        <div className={applyStyles.quiz} id={fieldId("understanding")} tabIndex={-1}>
          <h3>Check you have understood</h3>
          <p>
            Six short questions, taken straight from the agreement. This is not training. You need all six right to continue, and you can try as
            often as you like.
          </p>
          {agreement.understanding.map((question, index) => (
            <div className={applyStyles.question} key={question.id}>
              <RadioGroup
                name={`understanding-${question.id}`}
                legend={`${index + 1}. ${question.prompt}`}
                stacked
                options={question.options.map((option) => ({ value: option.id, label: option.text }))}
                value={understanding[question.id] ?? ""}
                onChange={(value) => {
                  setChecked(false);
                  onUnderstanding({ ...understanding, [question.id]: value });
                }}
              />
              {result?.needsAnotherLook.includes(question.id) ? <span className={applyStyles.questionFlag}>Question {index + 1} needs another look.</span> : null}
            </div>
          ))}
          <div>
            <button type="button" className="button button--secondary" onClick={() => setChecked(true)}>
              <span>Check my answers</span>
            </button>
          </div>
          <div role="status" aria-live="polite">
            {result ? (
              result.ok ? (
                <p className={applyStyles.quizResult} data-ok="true">
                  All six answers are right. You can continue.
                </p>
              ) : (
                <p className={applyStyles.quizResult} data-ok="false">
                  {result.needsAnotherLook.length === 1 ? "One question needs another look" : `${result.needsAnotherLook.length} questions need another look`}:{" "}
                  {result.needsAnotherLook.map((id) => `question ${numberOf(id)}`).join(", ")}. Read the agreement again and change your answer.
                </p>
              )
            ) : null}
          </div>
          {errors.understanding ? (
            <span className="field-error" id={`${fieldId("understanding")}-error`}>
              {errors.understanding}
            </span>
          ) : null}
        </div>
      ) : null}

      <TextField
        name="typedName"
        label={typedNameLabel}
        hint={typedNameHint}
        value={typedName}
        onChange={onTypedName}
        error={errors.typedName}
        autoComplete="name"
        maxLength={140}
        full
      />
    </div>
  );
}
