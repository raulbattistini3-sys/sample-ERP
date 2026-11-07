package com.simple_erp.billing.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class InternalTokenFilterTest {

	private final InternalTokenFilter filter = new InternalTokenFilter("segredo");

	private MockHttpServletResponse call(String requestUri, String servletPath, String authorization) throws Exception {
		MockHttpServletRequest request = new MockHttpServletRequest("GET", requestUri);
		request.setServletPath(servletPath);
		if (authorization != null) {
			request.addHeader("Authorization", authorization);
		}
		MockHttpServletResponse response = new MockHttpServletResponse();
		this.filter.doFilter(request, response, new MockFilterChain());
		return response;
	}

	@Test
	void rejectsAMissingOrWrongToken() throws Exception {
		assertThat(call("/internal/stripe/status", "/internal/stripe/status", null).getStatus()).isEqualTo(401);
		assertThat(call("/internal/stripe/status", "/internal/stripe/status", "Bearer errado").getStatus()).isEqualTo(401);
		assertThat(call("/internal/stripe/status", "/internal/stripe/status", "Bearer segredo").getStatus()).isEqualTo(200);
	}

	// behind the gateway the forwarded prefix makes the URI /billing/internal/...: still checked
	@Test
	void checksTheServletPathNotTheForwardedUri() throws Exception {
		assertThat(call("/billing/internal/stripe/status", "/internal/stripe/status", null).getStatus()).isEqualTo(401);
	}

	@Test
	void leavesOtherPathsAlone() throws Exception {
		assertThat(call("/webhooks/stripe", "/webhooks/stripe", null).getStatus()).isEqualTo(200);
	}

}
