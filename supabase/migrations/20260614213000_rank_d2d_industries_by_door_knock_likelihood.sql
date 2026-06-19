BEGIN;

WITH ranked_industries(slug, priority) AS (
  VALUES
    ('solar-installers', 1),
    ('home-security', 2),
    ('real-estate-teams', 3),
    ('roofing-contractors', 4),
    ('pest-control', 5),
    ('internet-providers', 6),
    ('lawn-care', 7),
    ('landscaping', 8),
    ('driveway-sealing-paving', 9),
    ('windows-doors', 10),
    ('painting', 11),
    ('hvac-contractors', 12),
    ('garage-doors', 13),
    ('siding-contractors', 14),
    ('water-treatment', 15),
    ('energy-retailers', 16),
    ('snow-removal', 17),
    ('decks-fences', 18),
    ('insulation', 19),
    ('concrete-contractors', 20),
    ('masonry', 21),
    ('pools-spas', 22),
    ('irrigation', 23),
    ('tree-service', 24),
    ('cleaning', 25),
    ('duct-cleaning', 26),
    ('carpet-cleaning', 27),
    ('chimney-service', 28),
    ('moving-companies', 29),
    ('junk-removal', 30),
    ('flooring', 31),
    ('blinds-shutters', 32),
    ('restoration', 33),
    ('property-management', 34),
    ('mortgage-brokers', 35),
    ('insurance-brokers', 36),
    ('financial-advisors', 37),
    ('senior-home-care', 38),
    ('private-tutoring', 39),
    ('pet-services', 40),
    ('home-organization', 41),
    ('mobile-car-detailing', 42),
    ('appliance-repair', 43),
    ('locksmiths', 44)
)
UPDATE public.prospect_industries AS industry
SET
  priority = ranked_industries.priority,
  updated_at = now()
FROM ranked_industries
WHERE industry.slug = ranked_industries.slug;

COMMIT;
