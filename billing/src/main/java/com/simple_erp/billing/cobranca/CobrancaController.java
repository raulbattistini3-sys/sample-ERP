package com.simple_erp.billing.cobranca;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Invoice;
import com.stripe.net.RequestOptions;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.CustomerListParams;
import com.stripe.param.InvoiceCreateParams;
import com.stripe.param.InvoiceFinalizeInvoiceParams;
import com.stripe.param.InvoiceItemCreateParams;
import com.stripe.param.InvoiceSearchParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Cobranças: one Stripe invoice per client, payable on Stripe's hosted page. Stripe sends no e-mail
 * (send_invoice, finalized but never "sent"): the Node API mails the link through Resend.
 *
 * Every Stripe call carries an idempotency key built from the request's {@code chave} (the gateway's
 * Idempotency-Key), the client and the step, so retrying the same request can't bill anyone twice.
 */
@Slf4j
@RestController
@RequestMapping("/internal/cobrancas")
@RequiredArgsConstructor
class CobrancaController {

	static final String ORIGEM = "sample-erp";

	private static final int RECENTES = 30;

	private final StripeClient stripe;

	@PostMapping
	List<Resultado> criar(@Valid @RequestBody Pedido pedido) {
		List<Resultado> resultados = new ArrayList<>();
		for (Cliente cliente : pedido.clientes()) {
			try {
				resultados.add(cobrar(pedido, cliente));
			}
			catch (StripeException ex) {
				log.warn("Cobrança for {} failed: {}", cliente.id(), ex.getMessage());
				String mensagem = ex.getUserMessage() != null ? ex.getUserMessage() : ex.getMessage();
				resultados.add(Resultado.falha(cliente.id(), mensagem));
			}
		}
		return resultados;
	}

	@GetMapping
	List<Fatura> recentes() throws StripeException {
		return this.stripe.v1()
			.invoices()
			.search(InvoiceSearchParams.builder()
				.setQuery("metadata['origem']:'" + ORIGEM + "'")
				.setLimit((long) RECENTES)
				.build())
			.getData()
			.stream()
			.map(Fatura::de)
			.toList();
	}

	private Resultado cobrar(Pedido pedido, Cliente cliente) throws StripeException {
		String base = pedido.chave() + ":" + cliente.id();
		Customer customer = customer(cliente, base);

		Invoice draft = this.stripe.v1()
			.invoices()
			.create(InvoiceCreateParams.builder()
				.setCustomer(customer.getId())
				.setCollectionMethod(InvoiceCreateParams.CollectionMethod.SEND_INVOICE)
				.setDaysUntilDue((long) pedido.vencimentoDias())
				.setCurrency("brl")
				.setDescription(pedido.descricao())
				// nothing else pending on the customer slips into this invoice
				.setPendingInvoiceItemsBehavior(InvoiceCreateParams.PendingInvoiceItemsBehavior.EXCLUDE)
				.setAutoAdvance(false)
				.putMetadata("origem", ORIGEM)
				.putMetadata("hubspot_id", cliente.id())
				.putMetadata("emissor", pedido.emissor().email())
				.build(), idempotency(base + ":fatura"));

		this.stripe.v1()
			.invoiceItems()
			.create(InvoiceItemCreateParams.builder()
				.setCustomer(customer.getId())
				.setInvoice(draft.getId())
				.setAmount(pedido.valorCentavos())
				.setCurrency("brl")
				.setDescription(pedido.descricao())
				.build(), idempotency(base + ":item"));

		// keyed too: replaying the request returns this same finalized invoice instead of "already finalized"
		Invoice invoice = this.stripe.v1()
			.invoices()
			.finalizeInvoice(draft.getId(), InvoiceFinalizeInvoiceParams.builder().build(), idempotency(base + ":finalizar"));
		return new Resultado(cliente.id(), true, invoice.getId(), invoice.getNumber(), invoice.getHostedInvoiceUrl(),
				invoice.getAmountDue(), invoice.getDueDate() != null ? Instant.ofEpochSecond(invoice.getDueDate()) : null,
				null);
	}

	// the client's Stripe customer, by e-mail; created the first time
	private Customer customer(Cliente cliente, String base) throws StripeException {
		String email = cliente.email().trim().toLowerCase(Locale.ROOT);
		List<Customer> existing = this.stripe.v1()
			.customers()
			.list(CustomerListParams.builder().setEmail(email).setLimit(1L).build())
			.getData();
		if (!existing.isEmpty()) {
			return existing.get(0);
		}
		return this.stripe.v1()
			.customers()
			.create(CustomerCreateParams.builder()
				.setEmail(email)
				.setName(cliente.nome())
				.putMetadata("hubspot_id", cliente.id())
				.build(), idempotency(base + ":cliente"));
	}

	private static RequestOptions idempotency(String key) {
		return RequestOptions.builder().setIdempotencyKey(key).build();
	}

	record Emissor(@NotBlank String nome, @NotBlank @Email String email) {
	}

	record Cliente(@NotBlank String id, @NotBlank String nome, @NotBlank @Email String email) {
	}

	record Pedido(@NotBlank @Pattern(regexp = "[A-Za-z0-9_.:-]{8,200}") String chave,
			@NotBlank @Size(max = 200) String descricao, @Min(100) @Max(100_000_000) long valorCentavos,
			@Min(1) @Max(60) int vencimentoDias, @Valid Emissor emissor,
			@Size(min = 1, max = 50) List<@Valid Cliente> clientes) {
	}

	record Resultado(String clienteId, boolean ok, String faturaId, String numero, String url, Long valorCentavos,
			Instant vencimento, String erro) {

		static Resultado falha(String clienteId, String erro) {
			return new Resultado(clienteId, false, null, null, null, null, null, erro);
		}

	}

	record Fatura(String id, String numero, String status, String clienteNome, String clienteEmail,
			long valorCentavos, long pagoCentavos, Instant criadaEm, Instant vencimento, String url, String emissor) {

		static Fatura de(Invoice i) {
			return new Fatura(i.getId(), i.getNumber(), i.getStatus(), i.getCustomerName(), i.getCustomerEmail(),
					i.getAmountDue() != null ? i.getAmountDue() : 0, i.getAmountPaid() != null ? i.getAmountPaid() : 0,
					Instant.ofEpochSecond(i.getCreated()), i.getDueDate() != null ? Instant.ofEpochSecond(i.getDueDate()) : null,
					i.getHostedInvoiceUrl(), i.getMetadata() != null ? i.getMetadata().get("emissor") : null);
		}

	}

}
