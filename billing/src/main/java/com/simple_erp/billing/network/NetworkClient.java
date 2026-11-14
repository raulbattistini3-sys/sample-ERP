package com.simple_erp.billing.network;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Billing's side of the network service (network/, Go): registers billing under its service name and an
 * instance id, and finds other services (the API) by name. Every call is signed like
 * network/registry/sign.go: {@code X-Network-Signature: t=<unix s>,n=<nonce>,s=hex(HMAC-SHA256(token,
 * t\nn\nMETHOD\npath\nhex(sha256(body))))}, so someone in the middle can't forge, alter or replay one.
 */
public final class NetworkClient {

	static final String HEADER = "X-Network-Signature";

	private static final Duration TIMEOUT = Duration.ofSeconds(3);

	private static final long CACHE_MILLIS = 5_000;

	private static final SecureRandom RANDOM = new SecureRandom();

	private final String base;

	private final byte[] token;

	private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();

	private final ObjectMapper json = new ObjectMapper();

	private final Map<String, Cached> cache = new ConcurrentHashMap<>();

	private record Cached(long at, List<String> addresses, AtomicInteger next) {
	}

	public NetworkClient(String base, String token) {
		this.base = base.replaceAll("/+$", "");
		this.token = token.getBytes(StandardCharsets.UTF_8);
	}

	static String sign(byte[] token, String method, String path, byte[] body, Instant now) {
		try {
			byte[] n = new byte[12];
			RANDOM.nextBytes(n);
			String nonce = HexFormat.of().formatHex(n);
			String t = Long.toString(now.getEpochSecond());
			String bodyHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
			Mac mac = Mac.getInstance("HmacSHA256");
			mac.init(new SecretKeySpec(token, "HmacSHA256"));
			String payload = t + "\n" + nonce + "\n" + method.toUpperCase() + "\n" + path + "\n" + bodyHash;
			String s = HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
			return "t=" + t + ",n=" + nonce + ",s=" + s;
		}
		catch (NoSuchAlgorithmException | java.security.InvalidKeyException error) {
			throw new IllegalStateException(error);
		}
	}

	private JsonNode call(String method, String path, Object body) throws Exception {
		byte[] raw = body == null ? new byte[0] : this.json.writeValueAsBytes(body);
		HttpRequest request = HttpRequest.newBuilder(URI.create(this.base + path))
			.timeout(TIMEOUT)
			.header("Content-Type", "application/json")
			.header(HEADER, sign(this.token, method, path, raw, Instant.now()))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(raw))
			.build();
		HttpResponse<byte[]> response = this.http.send(request, HttpResponse.BodyHandlers.ofByteArray());
		if (response.statusCode() >= 300) {
			throw new IllegalStateException("network " + method + " " + path + ": HTTP " + response.statusCode());
		}
		return response.body().length == 0 ? null : this.json.readTree(response.body());
	}

	public void register(String service, String id, Map<String, Object> registration) throws Exception {
		call("PUT", "/registry/" + service + "/" + id, registration);
	}

	public void deregister(String service, String id) throws Exception {
		call("DELETE", "/registry/" + service + "/" + id, null);
	}

	/** One healthy instance's address, round robin; null when none is registered or the network is down. */
	public String address(String service) {
		long now = System.currentTimeMillis();
		Cached seen = this.cache.get(service);
		if (seen == null || now - seen.at() >= CACHE_MILLIS) {
			try {
				JsonNode out = call("GET", "/registry/" + service, null);
				List<String> addresses = out == null ? List.of()
						: java.util.stream.StreamSupport.stream(out.path("instances").spliterator(), false)
							.map((i) -> i.path("address").asText(""))
							.filter((a) -> !a.isBlank())
							.toList();
				seen = new Cached(now, addresses, seen == null ? new AtomicInteger() : seen.next());
				this.cache.put(service, seen);
			}
			catch (Exception error) {
				// keep the last list while the network is down for a moment
				if (seen == null) {
					return null;
				}
			}
		}
		if (seen.addresses().isEmpty()) {
			return null;
		}
		return seen.addresses().get(Math.floorMod(seen.next().getAndIncrement(), seen.addresses().size()));
	}

}
