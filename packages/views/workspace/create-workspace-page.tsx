"use client";

import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@multica/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@multica/ui/components/ui/field";
import { useCreateWorkspace } from "@multica/core/workspace/mutations";
import { useConfigStore } from "@multica/core/config";
import { matchLocale } from "@multica/core/i18n";
import { isReservedSlug } from "@multica/core/paths";
import { workspaceUrlHost } from "@multica/core/workspace/workspace-url";
import type { Workspace } from "@multica/core/types";
import { useLogout } from "../auth";
import { DragStrip } from "../platform";
import { useT } from "../i18n";
import {
  WORKSPACE_SLUG_REGEX,
  isWorkspaceSlugConflict,
  nameToWorkspaceSlug,
} from "./slug";

/**
 * Plain create-workspace screen: name + URL, then straight into the new
 * workspace. Users normally never see it — the server joins everyone to the
 * company workspace on sign-in — so it only covers the zero-workspace edge
 * and the sidebar's "Create workspace" action.
 */
export function CreateWorkspacePage({
  onCreated,
  onCancel,
}: {
  onCreated: (workspace: Workspace) => void;
  /** Omit when the user has no workspace to return to. */
  onCancel?: () => void;
}) {
  const { t, i18n } = useT("workspace");
  const locale = matchLocale([i18n.resolvedLanguage ?? i18n.language]);
  const creationDisabled = useConfigStore((s) => s.workspaceCreationDisabled);
  const urlHost = workspaceUrlHost(useConfigStore((s) => s.daemonAppUrl));
  const logout = useLogout();
  const createWorkspace = useCreateWorkspace();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugServerError, setSlugServerError] = useState<string | null>(null);
  const slugTouched = useRef(false);

  const slugError =
    slug.length > 0 && !WORKSPACE_SLUG_REGEX.test(slug)
      ? t(($) => $.create_form.errors.slug_format)
      : slug.length > 0 && isReservedSlug(slug)
        ? t(($) => $.create_form.errors.slug_reserved)
        : slugServerError;
  const canCreate =
    name.trim().length > 0 && slug.trim().length > 0 && !slugError;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate || createWorkspace.isPending) return;
    createWorkspace.mutate(
      { name: name.trim(), slug: slug.trim() },
      {
        onSuccess: onCreated,
        onError: (error) => {
          if (isWorkspaceSlugConflict(error)) {
            setSlugServerError(t(($) => $.create_form.errors.slug_taken));
            toast.error(t(($) => $.create_form.errors.slug_conflict_toast));
            return;
          }
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : t(($) => $.create_form.errors.create_failed),
          );
        },
      },
    );
  };

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <DragStrip />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        {creationDisabled ? (
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{t(($) => $.creation_disabled.title)}</CardTitle>
              <CardDescription>
                {t(($) => $.creation_disabled.description)}
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex gap-2">
              {onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  {t(($) => $.new_page.back)}
                </Button>
              )}
              <Button variant="outline" onClick={logout}>
                {t(($) => $.new_page.log_out)}
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card className="w-full max-w-md">
            <form onSubmit={handleSubmit}>
              <CardHeader>
                <CardTitle>{t(($) => $.create_form.submit)}</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="ws-name">
                      {t(($) => $.create_form.name_label)}
                    </FieldLabel>
                    <Input
                      id="ws-name"
                      autoFocus
                      value={name}
                      placeholder={t(($) => $.create_form.name_placeholder)}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (!slugTouched.current) {
                          setSlug(nameToWorkspaceSlug(e.target.value, locale));
                          setSlugServerError(null);
                        }
                      }}
                    />
                  </Field>
                  <Field data-invalid={slugError ? true : undefined}>
                    <FieldLabel htmlFor="ws-slug">
                      {t(($) => $.create_form.url_label)}
                    </FieldLabel>
                    <div className="flex items-center rounded-md border bg-muted transition-colors focus-within:border-foreground">
                      <span className="select-none pl-3 font-mono text-body text-muted-foreground">
                        {`${urlHost}/`}
                      </span>
                      <Input
                        id="ws-slug"
                        value={slug}
                        placeholder={t(($) => $.create_form.url_placeholder)}
                        className="border-0 bg-transparent font-mono shadow-none focus-visible:ring-0"
                        onChange={(e) => {
                          slugTouched.current = true;
                          setSlug(e.target.value);
                          setSlugServerError(null);
                        }}
                      />
                    </div>
                    {slugError ? <FieldError>{slugError}</FieldError> : null}
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="mt-6 flex justify-end gap-2">
                {onCancel ? (
                  <Button type="button" variant="ghost" onClick={onCancel}>
                    {t(($) => $.new_page.back)}
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" onClick={logout}>
                    {t(($) => $.new_page.log_out)}
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={!canCreate || createWorkspace.isPending}
                >
                  {createWorkspace.isPending
                    ? t(($) => $.create_form.submitting)
                    : t(($) => $.create_form.submit)}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
