import { describe, expect, it } from "vitest";
import { S3StorageAdapter, signV4, storage } from "@/server/storage/storage";

describe("S3 SigV4 signing", () => {
  // Example "GET Object" request from the AWS Signature Version 4 documentation
  // (docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html).
  it("matches the documented AWS example signature", () => {
    const auth = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        range: "bytes=0-9",
        "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      amzDate: "20130524T000000Z",
    });
    expect(auth).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("lists paginated artifact keys from S3", async () => {
    const originalFetch = globalThis.fetch;
    const requests: URL[] = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      void init;
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (requests.length === 1) {
        return new Response("<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken><Contents><Key>3dpresentation/previews/build/a.js</Key></Contents></ListBucketResult>");
      }
      return new Response("<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>3dpresentation/previews/build/b.js</Key></Contents></ListBucketResult>");
    }) as typeof fetch;
    try {
      const adapter = new S3StorageAdapter({ bucket: "test-bucket", region: "us-east-1", accessKeyId: "test-key", secretAccessKey: "test-secret" });
      await expect(adapter.list("previews/build/")).resolves.toEqual(["previews/build/a.js", "previews/build/b.js"]);
      expect(requests).toHaveLength(2);
      expect(requests[0].pathname).toBe("/");
      expect(requests[0].searchParams.get("prefix")).toBe("3dpresentation/previews/build/");
      expect(requests[1].searchParams.get("continuation-token")).toBe("next&token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps media and artifact objects under the 3dpresentation prefix", async () => {
    const originalFetch = globalThis.fetch;
    const paths: string[] = [];
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      paths.push(new URL(input instanceof Request ? input.url : String(input)).pathname);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      const adapter = new S3StorageAdapter({ bucket: "test-bucket", region: "us-east-1", accessKeyId: "test-key", secretAccessKey: "test-secret" });
      await adapter.put("owner/abcdefghijklmnop.png", Buffer.from("media"), "image/png");
      await adapter.get("previews/build/index.html");
      await adapter.delete("runtime/hash/manifest.json");
      expect(paths).toEqual([
        "/3dpresentation/owner/abcdefghijklmnop.png",
        "/3dpresentation/previews/build/index.html",
        "/3dpresentation/runtime/hash/manifest.json",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stores and removes local artifact prefixes", async () => {
    const adapter = storage();
    const prefix = `previews/storage-test-${Date.now()}/`;
    await adapter.put(`${prefix}index.html`, Buffer.from("hello"), "text/html");
    await expect(adapter.list(prefix)).resolves.toEqual([`${prefix}index.html`]);
    await adapter.deletePrefix(prefix);
    await expect(adapter.list(prefix)).resolves.toEqual([]);
  });
});
