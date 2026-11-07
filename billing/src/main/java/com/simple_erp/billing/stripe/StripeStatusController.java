package com.simple_erp.billing.stripe;

import java.time.Instant;
import java.util.List;

import com.simple_erp.billing.config.StripeProperties;
import com.stripe.StripeClient;
import com.stripe.exception.AuthenticationException;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import com.stripe.model.Event;
import com.stripe.model.Invoice;
import com.stripe.model.StripeObject;
import com.stripe.param.EventListParams;
import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * What the Integrações page shows for Stripe, asked of Stripe live with the key billing runs with: is it
 * connected (the key works, which account, test or live), and the latest events, as a log.
 */
@RestController
@RequestMapping("/internal/stripe")
@RequiredArgsConstructor
class StripeStatusController {

	private static final int MAX_EVENTS = 50;

	private final StripeClient stripe;

	private final StripeProperties properties;

	@GetMapping("/status")
	Status status() {
		boolean teste = this.properties.apiKey().startsWith("sk_test_") || this.properties.apiKey().startsWith("rk_test_");
		boolean webhook = !this.properties.webhookSecret().isBlank();
		try {
			Account account = this.stripe.v1().accounts().retrieveCurrent();
			String nome = account.getSettings() != null && account.getSettings().getDashboard() != null
					? account.getSettings().getDashboard().getDisplayName() : null;
			if ((nome == null || nome.isBlank()) && account.getBusinessProfile() != null) {
				nome = account.getBusinessProfile().getName();
			}
			return new Status(true, new Conta(account.getId(), nome, account.getCountry(), account.getDefaultCurrency(),
					Boolean.TRUE.equals(account.getChargesEnabled())), teste, webhook, null);
		}
		catch (AuthenticationException ex) {
			return new Status(false, null, teste, webhook, "O Stripe recusou a chave (SANDBOX_STRIPE_API_KEY).");
		}
		catch (StripeException ex) {
			return new Status(false, null, teste, webhook, "O Stripe não respondeu: " + ex.getMessage());
		}
	}

	@GetMapping("/eventos")
	List<Evento> eventos(@RequestParam(defaultValue = "20") int limite) throws StripeException {
		long limit = Math.max(1, Math.min(limite, MAX_EVENTS));
		return this.stripe.v1()
			.events()
			.list(EventListParams.builder().setLimit(limit).build())
			.getData()
			.stream()
			.map(StripeStatusController::evento)
			.toList();
	}

	private static Evento evento(Event event) {
		StripeObject object = event.getDataObjectDeserializer().getObject().orElse(null);
		String resumo = null;
		if (object instanceof Invoice invoice) {
			resumo = "Fatura " + (invoice.getNumber() != null ? invoice.getNumber() : invoice.getId()) + " · "
					+ invoice.getStatus() + (invoice.getCustomerEmail() != null ? " · " + invoice.getCustomerEmail() : "");
		}
		return new Evento(event.getId(), event.getType(), Instant.ofEpochSecond(event.getCreated()),
				Boolean.TRUE.equals(event.getLivemode()), resumo);
	}

	record Conta(String id, String nome, String pais, String moeda, boolean cobrancasAtivas) {
	}

	record Status(boolean conectado, Conta conta, boolean modoTeste, boolean webhookConfigurado, String erro) {
	}

	record Evento(String id, String tipo, Instant criadoEm, boolean producao, String resumo) {
	}

}
