import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import {
  $createTextNode,
  COMMAND_PRIORITY_NORMAL,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import { SparkleIcon } from '@phosphor-icons/react';
import { useTypeaheadOpen } from './TypeaheadOpenContext';
import { TypeaheadMenu } from './TypeaheadMenu';

export type SkillDescriptionLike = {
  name: string;
  description?: string | null;
  short_description?: string | null;
  path: string;
  scope?: string | null;
  enabled?: boolean;
};

export type SelectedSkillLike = {
  name: string;
  path: string;
};

class SkillOption extends MenuOption {
  skill: SkillDescriptionLike;

  constructor(skill: SkillDescriptionLike) {
    super(`skill-${skill.path}`);
    this.skill = skill;
  }
}

export function filterSkills(
  all: SkillDescriptionLike[],
  query: string
): SkillDescriptionLike[] {
  const enabled = all.filter((skill) => skill.enabled !== false);
  const q = query.trim().toLowerCase();
  if (!q) return enabled;

  const startsWith = enabled.filter((skill) =>
    skill.name.toLowerCase().startsWith(q)
  );
  const includes = enabled.filter(
    (skill) =>
      !startsWith.includes(skill) && skill.name.toLowerCase().includes(q)
  );
  return [...startsWith, ...includes];
}

export function SkillTypeaheadPlugin({
  enabled,
  skills,
  isInitialized,
  isDiscovering,
  onSelectSkill,
}: {
  enabled: boolean;
  skills: SkillDescriptionLike[];
  isInitialized: boolean;
  isDiscovering: boolean;
  onSelectSkill: (skill: SelectedSkillLike) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const { setIsOpen } = useTypeaheadOpen();
  const [options, setOptions] = useState<SkillOption[]>([]);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const closeTypeahead = useCallback(() => {
    editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown'));
  }, [editor]);

  const isLoading = !isInitialized && enabled;

  const updateOptions = useCallback(
    (query: string | null) => {
      setActiveQuery(query);

      if (!enabled || query === null) {
        setOptions([]);
        return;
      }

      const filtered = filterSkills(skills, query).slice(0, 20);
      setOptions(filtered.map((skill) => new SkillOption(skill)));
    },
    [enabled, skills]
  );

  const hasVisibleResults = useMemo(() => {
    if (!enabled || activeQuery === null) return false;
    if (isLoading || isDiscovering) return true;
    if (!activeQuery.trim()) return true;
    return options.length > 0;
  }, [activeQuery, enabled, isDiscovering, isLoading, options.length]);

  useEffect(() => {
    if (activeQuery === null) return;
    updateOptions(activeQuery);
  }, [activeQuery, updateOptions]);

  return (
    <LexicalTypeaheadMenuPlugin<SkillOption>
      commandPriority={COMMAND_PRIORITY_NORMAL}
      triggerFn={(text) => {
        const match = /^(\s*)\$([^\s$]*)$/.exec(text);
        if (!match) return null;

        const dollarOffset = match[1].length;
        return {
          leadOffset: dollarOffset,
          matchingString: match[2],
          replaceableString: match[0].slice(dollarOffset),
        };
      }}
      options={options}
      onQueryChange={updateOptions}
      onOpen={() => setIsOpen(true)}
      onClose={() => setIsOpen(false)}
      onSelectOption={(option, nodeToReplace, closeMenu) => {
        editor.update(() => {
          if (!nodeToReplace) return;

          const skillNode = $createTextNode(`$${option.skill.name}`);
          nodeToReplace.replace(skillNode);

          const spaceNode = $createTextNode(' ');
          skillNode.insertAfter(spaceNode);
          spaceNode.select(1, 1);
        });

        onSelectSkill({
          name: option.skill.name,
          path: option.skill.path,
        });
        closeMenu();
      }}
      menuRenderFn={(
        anchorRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) => {
        if (!anchorRef.current) return null;
        if (!enabled) return null;
        if (!hasVisibleResults) return null;

        const isEmpty = !isLoading && !isDiscovering && skills.length === 0;
        const showLoadingRow = isLoading || isDiscovering;

        return createPortal(
          <TypeaheadMenu
            anchorEl={anchorRef.current}
            editorEl={editor.getRootElement()}
            onClickOutside={closeTypeahead}
          >
            <TypeaheadMenu.Header>
              <SparkleIcon className="size-icon-xs" weight="bold" />
              Skills
            </TypeaheadMenu.Header>

            {isEmpty ? (
              <TypeaheadMenu.Empty>No skills available</TypeaheadMenu.Empty>
            ) : options.length === 0 && !showLoadingRow ? null : (
              <TypeaheadMenu.ScrollArea>
                {showLoadingRow && (
                  <div className="px-base py-half text-sm text-low select-none">
                    Loading skills...
                  </div>
                )}
                {options.map((option, index) => {
                  const details =
                    option.skill.short_description ??
                    option.skill.description ??
                    null;

                  return (
                    <TypeaheadMenu.Item
                      key={option.key}
                      isSelected={index === selectedIndex}
                      index={index}
                      setHighlightedIndex={setHighlightedIndex}
                      onClick={() => selectOptionAndCleanUp(option)}
                    >
                      <div className="flex items-center justify-between gap-half font-medium">
                        <span className="font-mono">${option.skill.name}</span>
                        {option.skill.scope && (
                          <span className="text-xs text-low">
                            {option.skill.scope}
                          </span>
                        )}
                      </div>
                      {details && (
                        <div className="text-xs text-low truncate">
                          {details}
                        </div>
                      )}
                    </TypeaheadMenu.Item>
                  );
                })}
              </TypeaheadMenu.ScrollArea>
            )}
          </TypeaheadMenu>,
          document.body
        );
      }}
    />
  );
}
