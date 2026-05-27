// Form — labelled fields + actions. Headless: each Field renders a label
// + arbitrary child input, with optional hint/error rows below. Actions
// are split into primary (submit) + secondary (cancel/reset) slots.

import { classifiers as C } from '../../../../runtime/classifier';
import './Form.cls';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: any;
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <C.FormField>
      <C.FormLabel>{label}</C.FormLabel>
      {children}
      {hint && !error ? <C.FormHint>{hint}</C.FormHint> : null}
      {error ? <C.FormError>{error}</C.FormError> : null}
    </C.FormField>
  );
}

export interface FormProps {
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  primaryDisabled?: boolean;
  children?: any;
}

export function Form({
  primaryLabel = 'Submit',
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDisabled,
  children,
}: FormProps) {
  return (
    <C.FormRoot>
      {children}
      {(onPrimary || onSecondary) ? (
        <C.FormActions>
          {onSecondary && secondaryLabel ? (
            <C.FormSecondaryBtn onPress={onSecondary}>
              <C.FormBtnTextAlt>{secondaryLabel}</C.FormBtnTextAlt>
            </C.FormSecondaryBtn>
          ) : null}
          {onPrimary ? (
            <C.FormPrimaryBtn onPress={primaryDisabled ? undefined : onPrimary}>
              <C.FormBtnText>{primaryLabel}</C.FormBtnText>
            </C.FormPrimaryBtn>
          ) : null}
        </C.FormActions>
      ) : null}
    </C.FormRoot>
  );
}

export const FormSlots = {
  Input: C.FormInput,
};
