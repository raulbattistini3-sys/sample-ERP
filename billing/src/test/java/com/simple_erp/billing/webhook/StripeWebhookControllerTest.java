package com.simple_erp.billing.webhook;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.simple_erp.billing.config.SecurityConfig;
import com.simple_erp.billing.config.StripeConfig;
import com.stripe.net.Webhook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(StripeWebhookController.class)
@Import({ SecurityConfig.class, StripeConfig.class, StripeEventRecorder.class })
@TestPropertySource(properties = { "stripe.api-key=rk_test_unit", "stripe.webhook-secret=" + StripeWebhookControllerTest.SECRET })
class StripeWebhookControllerTest {

	static final String SECRET = "whsec_unit_test";

	private static final String INVOICE_PAID = """
			{"id":"evt_test_1","object":"v2.core.event","type":"v1.invoice.paid","livemode":false,
			"created":"2026-10-30T12:00:00.000Z",
			"related_object":{"id":"in_1","type":"invoice","url":"/v1/invoices/in_1"}}""";

	@Autowired
	private MockMvc mvc;

	@MockitoBean
	private StripeEventRepository events;

	@BeforeEach
	void newEvent() {
		when(this.events.insertIfNew(anyString(), anyString())).thenReturn(1);
	}

	@Test
	void recordsASignedEvent() throws Exception {
		send(INVOICE_PAID, signature(INVOICE_PAID, SECRET)).andExpect(status().isOk());

		verify(this.events).insertIfNew(eq("evt_test_1"), eq("v1.invoice.paid"));
	}

	@Test
	void answersOkForARetriedEvent() throws Exception {
		when(this.events.insertIfNew(anyString(), anyString())).thenReturn(0);

		send(INVOICE_PAID, signature(INVOICE_PAID, SECRET)).andExpect(status().isOk());
	}

	@Test
	void rejectsAnotherEndpointsSecret() throws Exception {
		send(INVOICE_PAID, signature(INVOICE_PAID, "whsec_other")).andExpect(status().isBadRequest());

		verify(this.events, never()).insertIfNew(anyString(), anyString());
	}

	@Test
	void rejectsAChangedBody() throws Exception {
		String changed = INVOICE_PAID.replace("in_1", "in_2");

		send(changed, signature(INVOICE_PAID, SECRET)).andExpect(status().isBadRequest());

		verify(this.events, never()).insertIfNew(anyString(), anyString());
	}

	@Test
	void keepsEverythingElseClosed() throws Exception {
		this.mvc.perform(get("/anything")).andExpect(status().isForbidden());
	}

	private org.springframework.test.web.servlet.ResultActions send(String body, String signature) throws Exception {
		return this.mvc.perform(post("/webhooks/stripe")
				.contentType(MediaType.APPLICATION_JSON)
				.header("Stripe-Signature", signature)
				.content(body));
	}

	private static String signature(String body, String secret) throws Exception {
		long timestamp = Webhook.Util.getTimeNow();
		return "t=" + timestamp + ",v1=" + Webhook.Util.computeHmacSha256(secret, timestamp + "." + body);
	}

}
