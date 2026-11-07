package com.simple_erp.billing.config;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * BILLING_ENV decides how billing connects to Postgres, like the API's API_ENV:
 * <ul>
 * <li>{@code production}: TLS, with the server's certificate verified against the CA (DATABASE_CA_CERT,
 * or prod-ca-2021.crt found from the working directory upwards). sslmode=disable and the other unverified
 * modes in JDBC_DATABASE_URL are refused: such a connection can be intercepted (MITM).</li>
 * <li>{@code development}: plain TCP (a local Postgres has no TLS), unless DATABASE_CA_CERT is set.</li>
 * </ul>
 * The JDBC URL is rewritten with sslmode=verify-full and sslrootcert, which pgjdbc enforces; Hikari and
 * Flyway both connect through it.
 */
public final class DatabaseTls {

	static final String DEFAULT_CA_FILE = "prod-ca-2021.crt";

	// billing/, the repo root, and one more
	private static final int CA_SEARCH_DEPTH = 3;

	private static final Set<String> INSECURE_SSL_MODES = Set.of("disable", "allow", "prefer", "require");

	private DatabaseTls() {
	}

	/** production or development; null (with the reason in errors) when BILLING_ENV is missing or wrong */
	static String mode(String billingEnv, List<String> errors) {
		String mode = (billingEnv == null) ? "" : billingEnv.trim().toLowerCase(Locale.ROOT);
		if (mode.equals("production") || mode.equals("development")) {
			return mode;
		}
		errors.add(mode.isEmpty() ? "BILLING_ENV is required: production or development (billing/.env)"
				: "BILLING_ENV=\"" + billingEnv + "\" is not valid: use production or development");
		return null;
	}

	/** jdbcUrl with its TLS parameters set for mode, or null (with the reason in errors) */
	static String rewrite(String jdbcUrl, String mode, String caCert, Path workingDir, List<String> errors) {
		int query = jdbcUrl.indexOf('?');
		String base = (query < 0) ? jdbcUrl : jdbcUrl.substring(0, query);
		List<String> kept = new ArrayList<>();
		String sslmode = null;
		if (query >= 0) {
			for (String pair : jdbcUrl.substring(query + 1).split("&")) {
				if (pair.isEmpty()) {
					continue;
				}
				String[] kv = pair.split("=", 2);
				String key = kv[0].toLowerCase(Locale.ROOT);
				if (key.equals("sslmode")) {
					sslmode = (kv.length > 1) ? kv[1].toLowerCase(Locale.ROOT) : "";
				}
				if (!key.startsWith("ssl")) {
					kept.add(pair);
				}
			}
		}
		boolean production = mode.equals("production");
		if (production && sslmode != null && INSECURE_SSL_MODES.contains(sslmode)) {
			errors.add("JDBC_DATABASE_URL has sslmode=" + sslmode
					+ ", but BILLING_ENV=production requires verified TLS; remove it");
			return null;
		}

		Path ca = null;
		if (caCert != null && !caCert.isBlank()) {
			ca = workingDir.resolve(caCert.trim()).toAbsolutePath().normalize();
		}
		else if (production) {
			ca = findUpwards(workingDir, DEFAULT_CA_FILE);
			if (ca == null) {
				errors.add("BILLING_ENV=production needs the database CA: put " + DEFAULT_CA_FILE
						+ " in the repo root or set DATABASE_CA_CERT");
				return null;
			}
		}
		if (ca == null) {
			kept.add("sslmode=disable");
		}
		else {
			String problem = checkCa(ca);
			if (problem != null) {
				errors.add(problem);
				return null;
			}
			kept.add("sslmode=verify-full");
			kept.add("sslrootcert=" + URLEncoder.encode(ca.toString(), StandardCharsets.UTF_8));
		}
		return base + "?" + String.join("&", kept);
	}

	private static Path findUpwards(Path start, String name) {
		Path dir = start.toAbsolutePath().normalize();
		for (int i = 0; i <= CA_SEARCH_DEPTH && dir != null; i++, dir = dir.getParent()) {
			Path candidate = dir.resolve(name);
			if (Files.isRegularFile(candidate)) {
				return candidate;
			}
		}
		return null;
	}

	private static String checkCa(Path ca) {
		try {
			if (!Files.readString(ca).contains("-----BEGIN CERTIFICATE-----")) {
				return ca + " is not a PEM certificate";
			}
			return null;
		}
		catch (IOException ex) {
			return "cannot read the database CA certificate " + ca + ": " + ex.getMessage();
		}
	}

}
