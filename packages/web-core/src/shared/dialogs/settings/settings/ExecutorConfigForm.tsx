import { useMemo, useEffect, useState, useCallback } from 'react';
import Form from '@rjsf/core';
import type { IChangeEvent } from '@rjsf/core';
import { RJSFSchema, RJSFValidationError } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useTranslation } from 'react-i18next';
import { BaseCodingAgent } from 'shared/types';
import { settingsRjsfTheme } from './rjsf/theme';
import { SettingsSaveBar } from './SettingsComponents';
import { CaretRightIcon } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

interface ExecutorConfigFormProps {
  executor: BaseCodingAgent;
  value: unknown;
  onChange?: (formData: unknown) => void;
  onSave?: (formData: unknown) => Promise<void>;
  onDiscard?: () => void;
  disabled?: boolean;
  saving?: boolean;
  isDirty?: boolean;
}

import schemas from 'virtual:executor-schemas';

const COMMON_EXECUTOR_CONFIG_FIELDS = new Set([
  'append_prompt',
  'model',
  'model_reasoning_effort',
  'reasoning_effort',
  'reasoning',
  'effort',
  'agent',
  'variant',
  'sandbox',
  'ask_for_approval',
  'approvals',
  'plan',
  'autonomy',
]);

type SplitExecutorSchema = {
  commonSchema: RJSFSchema;
  advancedSchema: RJSFSchema | null;
  commonFieldNames: string[];
  advancedFieldNames: string[];
};

function buildSectionSchema(schema: RJSFSchema, fieldNames: string[]) {
  const properties: NonNullable<RJSFSchema['properties']> = {};

  for (const fieldName of fieldNames) {
    const property = schema.properties?.[fieldName];
    if (property) {
      properties[fieldName] = property;
    }
  }

  return {
    ...schema,
    properties,
    required: Array.isArray(schema.required)
      ? schema.required.filter((fieldName) => fieldNames.includes(fieldName))
      : undefined,
  };
}

function splitExecutorSchema(schema: RJSFSchema): SplitExecutorSchema {
  const propertyNames = Object.keys(schema.properties ?? {});
  const commonFieldNames = propertyNames.filter((fieldName) =>
    COMMON_EXECUTOR_CONFIG_FIELDS.has(fieldName)
  );
  const advancedFieldNames = propertyNames.filter(
    (fieldName) => !COMMON_EXECUTOR_CONFIG_FIELDS.has(fieldName)
  );

  if (commonFieldNames.length === 0) {
    return {
      commonSchema: schema,
      advancedSchema: null,
      commonFieldNames: propertyNames,
      advancedFieldNames: [],
    };
  }

  return {
    commonSchema: buildSectionSchema(schema, commonFieldNames),
    advancedSchema:
      advancedFieldNames.length > 0
        ? buildSectionSchema(schema, advancedFieldNames)
        : null,
    commonFieldNames,
    advancedFieldNames,
  };
}

function pickSectionFormData(formData: unknown, fieldNames: string[]) {
  const source =
    formData && typeof formData === 'object'
      ? (formData as Record<string, unknown>)
      : {};
  const sectionData: Record<string, unknown> = {};

  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(source, fieldName)) {
      sectionData[fieldName] = source[fieldName];
    }
  }

  return sectionData;
}

function mergeSectionFormData(
  currentFormData: unknown,
  sectionFormData: unknown,
  fieldNames: string[]
) {
  const current =
    currentFormData && typeof currentFormData === 'object'
      ? (currentFormData as Record<string, unknown>)
      : {};
  const section =
    sectionFormData && typeof sectionFormData === 'object'
      ? (sectionFormData as Record<string, unknown>)
      : {};
  const next = { ...current };

  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(section, fieldName)) {
      next[fieldName] = section[fieldName];
    } else {
      delete next[fieldName];
    }
  }

  return next;
}

export function ExecutorConfigForm({
  executor,
  value,
  onChange,
  onSave,
  onDiscard,
  disabled = false,
  saving = false,
  isDirty = false,
}: ExecutorConfigFormProps) {
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState<unknown>(value || {});
  const [validationErrors, setValidationErrors] = useState<
    RJSFValidationError[]
  >([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const schema = useMemo(() => {
    return schemas[executor];
  }, [executor]);

  const splitSchema = useMemo(() => {
    return schema ? splitExecutorSchema(schema) : null;
  }, [schema]);

  // Custom handler for env field updates
  const handleEnvChange = useCallback(
    (envData: Record<string, string> | undefined) => {
      const newFormData = {
        ...(formData as Record<string, unknown>),
        env: envData,
      };
      setFormData(newFormData);
      if (onChange) {
        onChange(newFormData);
      }
    },
    [formData, onChange]
  );

  const uiSchema = useMemo(
    () => ({
      env: {
        'ui:field': 'KeyValueField',
      },
    }),
    []
  );

  // Pass the env update handler via formContext
  const formContext = useMemo(
    () => ({
      onEnvChange: handleEnvChange,
    }),
    [handleEnvChange]
  );

  useEffect(() => {
    setFormData(value || {});
    setValidationErrors([]);
    setAdvancedOpen(false);
  }, [value, executor]);

  const handleSectionChange =
    (fieldNames: string[]) => (event: IChangeEvent<unknown>) => {
      const newFormData = mergeSectionFormData(
        formData,
        event.formData,
        fieldNames
      );
      setFormData(newFormData);
      if (onChange) {
        onChange(newFormData);
      }
    };

  const handleChange = (newFormData: unknown) => {
    setFormData(newFormData);
    if (onChange) {
      onChange(newFormData);
    }
  };

  const handleSave = async () => {
    if (onSave) {
      await onSave(formData);
    }
  };

  const handleError = (errors: RJSFValidationError[]) => {
    setValidationErrors(errors);
  };

  if (!schema) {
    return (
      <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
        {t('settings.agents.errors.schemaNotFound', { executor })}
      </div>
    );
  }

  const hasValidationErrors = validationErrors.length > 0;
  const commonFormData = splitSchema
    ? pickSectionFormData(formData, splitSchema.commonFieldNames)
    : {};
  const advancedFormData = splitSchema?.advancedSchema
    ? pickSectionFormData(formData, splitSchema.advancedFieldNames)
    : {};

  return (
    <div className="space-y-4">
      <Form
        schema={splitSchema?.commonSchema ?? schema}
        uiSchema={uiSchema}
        formData={commonFormData}
        formContext={formContext}
        onChange={
          splitSchema
            ? handleSectionChange(splitSchema.commonFieldNames)
            : (event) => handleChange(event.formData)
        }
        onError={handleError}
        validator={validator}
        disabled={disabled}
        liveValidate
        showErrorList={false}
        widgets={settingsRjsfTheme.widgets}
        templates={settingsRjsfTheme.templates}
        fields={settingsRjsfTheme.fields}
      >
        {/* No submit button - SettingsSaveBar handles saving */}
        <></>
      </Form>

      {splitSchema?.advancedSchema && (
        <div className="border-t border-border pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-1 py-2 text-left text-sm font-medium text-normal hover:bg-secondary/60"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            <CaretRightIcon
              className={cn(
                'size-icon-xs shrink-0 transition-transform',
                advancedOpen && 'rotate-90'
              )}
              weight="bold"
            />
            <span>{t('settings.agents.editor.advancedConfig')}</span>
            <span className="ml-auto text-xs font-normal text-low">
              {t('settings.agents.editor.advancedConfigCount', {
                count: splitSchema.advancedFieldNames.length,
              })}
            </span>
          </button>

          {advancedOpen && (
            <div className="pt-1">
              <Form
                schema={splitSchema.advancedSchema}
                uiSchema={uiSchema}
                formData={advancedFormData}
                formContext={formContext}
                onChange={handleSectionChange(splitSchema.advancedFieldNames)}
                onError={handleError}
                validator={validator}
                disabled={disabled}
                liveValidate
                showErrorList={false}
                widgets={settingsRjsfTheme.widgets}
                templates={settingsRjsfTheme.templates}
                fields={settingsRjsfTheme.fields}
              >
                <></>
              </Form>
            </div>
          )}
        </div>
      )}

      {hasValidationErrors && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
          <ul className="list-disc list-inside space-y-1">
            {validationErrors.map((error, index) => (
              <li key={index}>
                {error.property}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onSave && (
        <SettingsSaveBar
          show={isDirty}
          saving={saving}
          saveDisabled={hasValidationErrors}
          unsavedMessage={t('settings.agents.save.unsavedChanges')}
          onSave={handleSave}
          onDiscard={onDiscard}
        />
      )}
    </div>
  );
}
