package com.simple_erp.billing.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ServerSocket;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

class DevPortFallbackTest {

	@Test
	void keepsAFreePort() {
		List<String> log = new ArrayList<>();
		assertThat(DevPortFallback.choose(8081, (p) -> true, log::add)).isEqualTo(8081);
		assertThat(log).isEmpty();
	}

	@Test
	void movesToTheNextFreePortAndLogsIt() {
		Set<Integer> taken = Set.of(8081, 8082);
		List<String> log = new ArrayList<>();
		assertThat(DevPortFallback.choose(8081, (p) -> !taken.contains(p), log::add)).isEqualTo(8083);
		assertThat(log).last().asString().contains("8081").contains("8083");
	}

	@Test
	void givesUpAfterMaxAttempts() {
		assertThat(DevPortFallback.choose(8081, (p) -> false, (m) -> {
		})).isEqualTo(-1);
	}

	@Test
	void seesARealTakenPort() throws Exception {
		try (ServerSocket taken = new ServerSocket(0)) {
			assertThat(DevPortFallback.isFree(null, taken.getLocalPort())).isFalse();
		}
	}

}
