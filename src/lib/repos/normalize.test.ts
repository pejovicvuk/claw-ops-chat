import { describe, expect, it } from "vitest";
import { githubHasNextPage, normalizeBitbucketRepo, normalizeGithubRepo } from "./normalize";

describe("normalizeGithubRepo", () => {
  const base = {
    name: "claude-code",
    full_name: "anthropics/claude-code",
    owner: { login: "anthropics" },
    description: "the cli",
    private: false,
    html_url: "https://github.com/anthropics/claude-code",
    clone_url: "https://github.com/anthropics/claude-code.git",
    pushed_at: "2026-04-01T12:00:00Z",
  };

  it("maps a typical repo payload to the cross-host shape", () => {
    const out = normalizeGithubRepo(base);
    expect(out).toMatchObject({
      host: "github.com",
      owner: "anthropics",
      name: "claude-code",
      fullName: "anthropics/claude-code",
      description: "the cli",
      private: false,
      htmlUrl: base.html_url,
      cloneUrl: base.clone_url,
    });
    expect(out?.pushedAt).toBe(Date.parse(base.pushed_at));
  });

  it("falls back to updated_at when pushed_at is missing", () => {
    const out = normalizeGithubRepo({
      ...base,
      pushed_at: undefined,
      updated_at: "2026-03-01T00:00:00Z",
    });
    expect(out?.pushedAt).toBe(Date.parse("2026-03-01T00:00:00Z"));
  });

  it("returns 0 pushedAt when neither timestamp is present", () => {
    const out = normalizeGithubRepo({ ...base, pushed_at: undefined, updated_at: undefined });
    expect(out?.pushedAt).toBe(0);
  });

  it("flags private repos", () => {
    expect(normalizeGithubRepo({ ...base, private: true })?.private).toBe(true);
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeGithubRepo({ ...base, name: undefined })).toBeNull();
    expect(normalizeGithubRepo({ ...base, owner: { login: 42 } })).toBeNull();
    expect(normalizeGithubRepo({ ...base, clone_url: undefined })).toBeNull();
    expect(normalizeGithubRepo({})).toBeNull();
  });

  it("treats a non-string description as null", () => {
    expect(normalizeGithubRepo({ ...base, description: null })?.description).toBeNull();
  });
});

describe("normalizeBitbucketRepo", () => {
  const base = {
    slug: "my-repo",
    name: "My Repo",
    full_name: "myws/my-repo",
    description: "stuff",
    is_private: true,
    updated_on: "2026-04-01T12:00:00Z",
    links: {
      html: { href: "https://bitbucket.org/myws/my-repo" },
      clone: [
        { name: "https", href: "https://bot@bitbucket.org/myws/my-repo.git" },
        { name: "ssh", href: "git@bitbucket.org:myws/my-repo.git" },
      ],
    },
  };

  it("maps a typical repo payload and strips embedded credentials from the clone URL", () => {
    const out = normalizeBitbucketRepo(base);
    expect(out).toMatchObject({
      host: "bitbucket.org",
      owner: "myws",
      name: "my-repo",
      fullName: "myws/my-repo",
      private: true,
      htmlUrl: base.links.html.href,
    });
    expect(out?.cloneUrl).toBe("https://bitbucket.org/myws/my-repo.git");
    expect(out?.cloneUrl).not.toContain("bot@");
  });

  it("appends .git to clone URLs that lack the suffix", () => {
    const out = normalizeBitbucketRepo({
      ...base,
      links: {
        ...base.links,
        clone: [{ name: "https", href: "https://bitbucket.org/myws/my-repo" }],
      },
    });
    expect(out?.cloneUrl).toBe("https://bitbucket.org/myws/my-repo.git");
  });

  it("returns null when no https clone link is present", () => {
    expect(
      normalizeBitbucketRepo({
        ...base,
        links: { ...base.links, clone: [{ name: "ssh", href: "git@bitbucket.org:x/y.git" }] },
      }),
    ).toBeNull();
  });

  it("returns null on missing slug or full_name", () => {
    expect(normalizeBitbucketRepo({ ...base, slug: undefined })).toBeNull();
    expect(normalizeBitbucketRepo({ ...base, full_name: undefined })).toBeNull();
  });

  it("collapses an empty description to null", () => {
    expect(normalizeBitbucketRepo({ ...base, description: "" })?.description).toBeNull();
  });
});

describe("githubHasNextPage", () => {
  it("returns true when the Link header contains rel=next", () => {
    expect(
      githubHasNextPage(
        '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"',
      ),
    ).toBe(true);
  });

  it("returns false when only rel=last is present (last page)", () => {
    expect(
      githubHasNextPage(
        '<https://api.github.com/user/repos?page=1>; rel="prev", <https://api.github.com/user/repos?page=1>; rel="first"',
      ),
    ).toBe(false);
  });

  it("returns false on null / empty header", () => {
    expect(githubHasNextPage(null)).toBe(false);
    expect(githubHasNextPage("")).toBe(false);
  });
});
