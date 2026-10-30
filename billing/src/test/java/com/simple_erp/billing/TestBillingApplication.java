package com.simple_erp.billing;

import org.springframework.boot.SpringApplication;

public class TestBillingApplication {

	public static void main(String[] args) {
		SpringApplication.from(BillingApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
