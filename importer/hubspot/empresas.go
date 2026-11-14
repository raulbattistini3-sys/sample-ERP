package hubspot

import (
	"context"
	"net/http"
	"strings"
)

// filter groups per search: HubSpot ORs up to 5 of them
const gruposPorBusca = 5

// Setor is one of HubSpot's values for a company's industry.
type Setor struct {
	Valor, Rotulo string
}

// Setores returns the company industry options HubSpot accepts (hidden ones left out), as
// api/src/services/hubspot.service.ts industryOptions reads them.
func (c *Client) Setores(ctx context.Context) ([]Setor, error) {
	var out struct {
		Options []struct {
			Value  string `json:"value"`
			Label  string `json:"label"`
			Hidden bool   `json:"hidden"`
		} `json:"options"`
	}
	err := c.chamar(ctx, http.MethodGet, "/crm/properties/"+apiVersion+"/companies/industry", nil, &out, false)
	if err != nil && !Fatal(err) && ctx.Err() == nil {
		err = c.chamar(ctx, http.MethodGet, "/crm/v3/properties/companies/industry", nil, &out, false)
	}
	if err != nil {
		return nil, err
	}
	setores := make([]Setor, 0, len(out.Options))
	for _, o := range out.Options {
		if !o.Hidden {
			setores = append(setores, Setor{Valor: o.Value, Rotulo: o.Label})
		}
	}
	return setores, nil
}

// BuscarEmpresas finds companies by name, 5 names per search: lowercase name -> id of the oldest company
// with it (as BuscarEmpresa). Names with no company are left out.
func (c *Client) BuscarEmpresas(ctx context.Context, nomes []string) (map[string]string, error) {
	achadas := make(map[string]string, len(nomes))
	for inicio := 0; inicio < len(nomes); inicio += gruposPorBusca {
		parte := nomes[inicio:min(inicio+gruposPorBusca, len(nomes))]
		grupos := make([]any, len(parte))
		for i, n := range parte {
			grupos[i] = map[string]any{"filters": []any{map[string]string{"propertyName": "name", "operator": "EQ", "value": n}}}
		}
		// sorted oldest first, so the first result for a name is the one kept; a name repeated more than 200
		// times in HubSpot could hide another's, which only means that one is looked up again (and created)
		var out resultados
		err := c.chamar(ctx, http.MethodPost, empresas+"/search", map[string]any{
			"limit": 200, "properties": []string{"name"}, "filterGroups": grupos,
			"sorts": []any{map[string]string{"propertyName": "createdate", "direction": "ASCENDING"}},
		}, &out, true)
		if err != nil {
			return nil, err
		}
		for _, o := range out.Results {
			chave := strings.ToLower(strings.TrimSpace(o.Properties["name"]))
			if _, ja := achadas[chave]; !ja {
				achadas[chave] = o.ID
			}
		}
	}
	return achadas, nil
}

// Empresa is one company to write. Empty properties are not sent, so an import never blanks what HubSpot
// already has.
type Empresa struct {
	ID           string // empty: create
	Propriedades map[string]string
}

func semVazias(props map[string]string) map[string]string {
	out := make(map[string]string, len(props))
	for k, v := range props {
		if v != "" {
			out[k] = v
		}
	}
	return out
}

// CriarEmpresas creates companies in one call and returns their ids by lowercase name.
func (c *Client) CriarEmpresas(ctx context.Context, novas []Empresa) (map[string]string, error) {
	inputs := make([]any, len(novas))
	for i, e := range novas {
		inputs[i] = map[string]any{"properties": semVazias(e.Propriedades)}
	}
	var out resultados
	if err := c.chamar(ctx, http.MethodPost, empresas+"/batch/create", map[string]any{"inputs": inputs}, &out, false); err != nil {
		return nil, err
	}
	return porNome(out), nil
}

// AtualizarEmpresas updates companies by id in one call and returns the ids it updated.
func (c *Client) AtualizarEmpresas(ctx context.Context, existentes []Empresa) (map[string]bool, error) {
	inputs := make([]any, len(existentes))
	for i, e := range existentes {
		inputs[i] = map[string]any{"id": e.ID, "properties": semVazias(e.Propriedades)}
	}
	var out resultados
	if err := c.chamar(ctx, http.MethodPost, empresas+"/batch/update", map[string]any{"inputs": inputs}, &out, false); err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(out.Results))
	for _, o := range out.Results {
		ids[o.ID] = true
	}
	return ids, nil
}

func porNome(out resultados) map[string]string {
	ids := make(map[string]string, len(out.Results))
	for _, o := range out.Results {
		ids[strings.ToLower(strings.TrimSpace(o.Properties["name"]))] = o.ID
	}
	return ids
}
