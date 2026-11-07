package com.simple_erp.billing.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DatabaseTlsTest {

	private static final String URL = "jdbc:postgresql://db.example.com:5432/postgres?user=u&password=p";

	@TempDir
	Path dir;

	private Path writeCa(Path where) throws IOException {
		Files.createDirectories(where.getParent());
		return Files.writeString(where, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
	}

	@Test
	void developmentWithoutCaIsPlain() {
		List<String> errors = new ArrayList<>();
		String url = DatabaseTls.rewrite(URL + "&sslmode=require&sslfactory=x", "development", null, this.dir, errors);
		assertThat(errors).isEmpty();
		assertThat(url).isEqualTo(URL + "&sslmode=disable");
	}

	@Test
	void productionFindsTheRepoCaAndVerifies() throws IOException {
		Path ca = writeCa(this.dir.resolve(DatabaseTls.DEFAULT_CA_FILE));
		Path billing = Files.createDirectories(this.dir.resolve("billing"));
		List<String> errors = new ArrayList<>();
		String url = DatabaseTls.rewrite(URL, "production", "", billing, errors);
		assertThat(errors).isEmpty();
		assertThat(url).startsWith(URL + "&sslmode=verify-full&sslrootcert=")
			.contains(ca.getFileName().toString());
	}

	@Test
	void productionRefusesUnverifiedModes() throws IOException {
		writeCa(this.dir.resolve(DatabaseTls.DEFAULT_CA_FILE));
		for (String mode : List.of("disable", "prefer", "require")) {
			List<String> errors = new ArrayList<>();
			assertThat(DatabaseTls.rewrite(URL + "&sslmode=" + mode, "production", null, this.dir, errors)).isNull();
			assertThat(errors).singleElement().asString().contains("sslmode=" + mode);
		}
	}

	@Test
	void productionWithoutCaFails() {
		List<String> errors = new ArrayList<>();
		assertThat(DatabaseTls.rewrite(URL, "production", null, this.dir, errors)).isNull();
		assertThat(errors).singleElement().asString().contains("needs the database CA");
	}

	@Test
	void billingEnvMustBeKnown() {
		List<String> errors = new ArrayList<>();
		assertThat(DatabaseTls.mode(" Production ", errors)).isEqualTo("production");
		assertThat(DatabaseTls.mode(null, errors)).isNull();
		assertThat(DatabaseTls.mode("staging", errors)).isNull();
		assertThat(errors).hasSize(2);
	}

}
