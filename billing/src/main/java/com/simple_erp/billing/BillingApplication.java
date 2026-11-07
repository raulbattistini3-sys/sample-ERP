package com.simple_erp.billing;

import com.simple_erp.billing.config.StartupChecks;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BillingApplication {

	public static void main(String[] args) {
		SpringApplication app = new SpringApplication(BillingApplication.class);
		// required variables and the database's TLS, checked before any bean exists; exits with 1 on a problem
		app.addListeners(new StartupChecks());
		app.run(args);
	}

}
