# Scientific Methodology & References

Theoretical foundations and international standards underpinning the **DRR Analytics Agent Plugin**.

---

## 1. Global Earthquake Model (GEM) & HAZUS-MH Fragility Curves
Fragility curves define the conditional probability that a structural asset reaches or exceeds a designated damage state $ds_i$ given a specific ground shaking intensity measure ($IM$, typically Peak Ground Acceleration $PGA$ in units of gravitational acceleration $g$ or Spectral Acceleration $S_a$):

$$P(DS \ge ds_i \mid IM) = \Phi\left(\frac{\ln(IM / \theta_i)}{\beta_i}\right)$$

Where:
* $\Phi$ is the standard normal cumulative distribution function (CDF).
* $\theta_i$ is the median capacity value for damage state $i$.
* $\beta_i$ is the lognormal standard deviation (dispersion) encompassing structural capacity uncertainty and record-to-record hazard variability.

### Damage States:
1. **None ($ds_0$)**: No damage.
2. **Slight ($ds_1$)**: Hairline diagonal cracks in masonry/concrete, minor plaster cracking. Central damage factor: 5%.
3. **Moderate ($ds_2$)**: Extensive cosmetic cracks, minor yielding of steel rebar or shear failure in non-ductile columns. Central damage factor: 25%.
4. **Extensive ($ds_3$)**: Permanent structural drift, spalling of concrete cover, shear failure in structural walls. Central damage factor: 60%.
5. **Complete ($ds_4$)**: Partial or total building collapse. Central damage factor: 100%.

The Mean Damage Ratio ($MDR$) represents the expected economic loss as a percentage of the total structural replacement value:
$$\text{MDR} = \sum_{i=0}^{4} P(DS = ds_i) \times \text{DamageFactor}(ds_i)$$

---

## 2. United Nations Sendai Framework for Disaster Risk Reduction (2015–2030)
The Sendai Framework establishes four international outcome targets measured globally:
* **Target A**: Substantially reduce global disaster mortality by 2030.
* **Target B**: Substantially reduce the number of affected people globally by 2030 (specifically tracking displaced populations).
* **Target C**: Reduce direct disaster economic loss in relation to global gross domestic product (GDP) by 2030.
* **Target D**: Substantially reduce disaster damage to critical infrastructure and disruption of basic services, among them health and educational facilities.

This plugin maps deterministic physical damage directly to these indicators.

---

## 3. OASIS Common Alerting Protocol (CAP) v1.2 / ITU-T Recommendation X.1303
The Common Alerting Protocol provides an open data standard for exchanging public emergency warnings across diverse transmission media (cellular broadcast, sirens, radio, digital signs, Web/RSS).

Key specification requirements implemented:
* Namespace: `urn:oasis:names:tc:emergency:cap:1.2`
* Required parent fields: `identifier`, `sender`, `sent`, `status`, `msgType`, `scope`.
* Standardized enums for `urgency`, `severity`, and `certainty`.
* Geographic targeting using strict `lat,lon` coordinate polygons.

---

## 4. References & Standards
* **GEM Foundation**: *GEM Building Taxonomy v2.0* (Silva et al., 2018).
* **FEMA**: *HAZUS-MH 2.1 Multi-hazard Loss Estimation Methodology: Earthquake, Flood, and Hurricane Models* (Federal Emergency Management Agency).
* **ITU-T**: *Recommendation X.1303 (2007) Common Alerting Protocol (CAP 1.2)*.
* **OASIS Standards**: *Common Alerting Protocol Version 1.2* (OASIS Standard, 1 July 2010).
* **UNDRR**: *Technical Guidance for Monitoring and Reporting on Progress in Achieving the Global Targets of the Sendai Framework for Disaster Risk Reduction*.
* **GDACS**: *Global Disaster Alert and Coordination System Guidelines* (UN OCHA / EC DG ECHO).
* **Operational Playbook**: See [`docs/operational-playbook.md`](./operational-playbook.md) for real-world deployment timelines, stakeholder personas, and operational triggers.
